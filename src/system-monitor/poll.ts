import { MonitorConfig } from './config';
import { collectSample } from './metrics';
import { Decision, MetricStateMachine } from './state';
import { BreachInfo, MetricKey, SystemSample } from './types';
import { buildNotifiers } from '../shared/notifiers';
import { Notifier, NotifierMessage } from '../shared/notifiers/types';

function fmtBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)}${units[i]}`;
}

function fmtLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  parts.push(`${m}分`);
  return parts.join(' ');
}

interface MetricCheck {
  key: MetricKey;
  label: string;
  value: number;
  threshold: number;
  unit: string;
  /** 当 threshold <= 0 时跳过 */
  enabled: boolean;
}

export function buildChecks(sample: SystemSample, config: MonitorConfig): MetricCheck[] {
  const t = config.thresholds;
  const checks: MetricCheck[] = [
    {
      key: 'cpu',
      label: 'CPU',
      value: sample.cpuPercent,
      threshold: t.cpu_percent,
      unit: '%',
      enabled: t.cpu_percent > 0,
    },
    {
      key: 'memory',
      label: '内存',
      value: sample.memoryPercent,
      threshold: t.memory_percent,
      unit: '%',
      enabled: t.memory_percent > 0,
    },
    {
      key: 'load1m_per_core',
      label: `1m load/核(${sample.cpuCount}核)`,
      value: sample.load1mPerCore,
      threshold: t.load1m_per_core,
      unit: '',
      enabled: t.load1m_per_core > 0,
    },
  ];
  for (const disk of sample.disks) {
    checks.push({
      key: `disk:${disk.mount}` as MetricKey,
      label: `磁盘 ${disk.mount}`,
      value: disk.percent,
      threshold: t.disk_percent,
      unit: '%',
      enabled: t.disk_percent > 0,
    });
  }
  return checks;
}

function checkToBreach(c: MetricCheck): BreachInfo {
  return {
    key: c.key,
    label: c.label,
    value: c.value,
    threshold: c.threshold,
    unit: c.unit,
  };
}

function fmtValue(v: number, unit: string): string {
  if (unit === '%') return `${v.toFixed(1)}%`;
  return v.toFixed(2);
}

function summaryLine(sample: SystemSample, checks: MetricCheck[]): string {
  const pieces = [
    `cpu=${sample.cpuPercent.toFixed(1)}%`,
    `mem=${sample.memoryPercent.toFixed(1)}%`,
    `load1m/core=${sample.load1mPerCore.toFixed(2)}`,
  ];
  for (const d of sample.disks) {
    pieces.push(`${d.mount}=${d.percent.toFixed(1)}%`);
  }
  const breaches = checks.filter((c) => c.enabled && c.value >= c.threshold).length;
  pieces.push(`breaches=${breaches}`);
  return pieces.join(' ');
}

function snapshotBlock(sample: SystemSample, checks: MetricCheck[]): string {
  const lines: string[] = [];
  lines.push(`**主机**: ${sample.hostname} ｜ **当前**: ${fmtLocalTime(sample.tsMs)} ｜ **uptime**: ${fmtUptime(sample.uptimeSeconds)}`);
  lines.push('');
  for (const c of checks) {
    if (!c.enabled) continue;
    const flag = c.value >= c.threshold ? '🚨' : '  ';
    const extra =
      c.key === 'memory'
        ? ` (${fmtBytes(sample.memoryUsedBytes)} / ${fmtBytes(sample.memoryTotalBytes)})`
        : c.key === 'load1m_per_core'
        ? ` (1m=${sample.load[0].toFixed(2)}, 5m=${sample.load[1].toFixed(2)}, 15m=${sample.load[2].toFixed(2)})`
        : c.key.startsWith('disk:')
        ? (() => {
            const disk = sample.disks.find((d) => `disk:${d.mount}` === c.key);
            return disk ? ` (${fmtBytes(disk.usedBytes)} / ${fmtBytes(disk.totalBytes)})` : '';
          })()
        : '';
    lines.push(
      `${flag} ${c.label}: ${fmtValue(c.value, c.unit)} ｜阈值 ${fmtValue(c.threshold, c.unit)}${extra}`
    );
  }
  return lines.join('\n');
}

export interface TickResult {
  /** 单行 stdout 日志 */
  summary: string;
  /** 要发送的消息（按通道相同，按本次轮询聚合）；可能为空 */
  message: NotifierMessage | null;
}

/** 纯函数：从采样 + 状态机决策构造本次 tick 要发的消息 */
export function buildTickMessage(
  sample: SystemSample,
  config: MonitorConfig,
  fsm: MetricStateMachine
): TickResult {
  const checks = buildChecks(sample, config);
  const summary = `${fmtLocalTime(sample.tsMs)} ${summaryLine(sample, checks)}`;

  const newAlerts: MetricCheck[] = [];
  const recoveries: MetricCheck[] = [];
  for (const c of checks) {
    if (!c.enabled) continue;
    const decision = fsm.decide({
      key: c.key,
      breached: c.value >= c.threshold,
      snapshot: checkToBreach(c),
      policy: {
        consecutive_breaches: config.alert.consecutive_breaches,
        cooldown_minutes: config.alert.cooldown_minutes,
        send_recovery: config.alert.send_recovery,
      },
      nowMs: sample.tsMs,
    });
    if (decision.type === 'alert') newAlerts.push(c);
    else if (decision.type === 'recovery') recoveries.push(c);
  }

  if (newAlerts.length === 0 && recoveries.length === 0 && !config.alert.heartbeat) {
    return { summary, message: null };
  }

  const isWarn = newAlerts.length > 0;
  let title: string;
  if (newAlerts.length > 0 && recoveries.length > 0) {
    title = `🚨 系统资源告警 + 恢复 (${sample.hostname})`;
  } else if (newAlerts.length > 0) {
    title = `🚨 系统资源告警 (${sample.hostname})`;
  } else if (recoveries.length > 0) {
    title = `✅ 系统资源恢复 (${sample.hostname})`;
  } else {
    title = `📊 系统资源心跳 (${sample.hostname})`;
  }

  const sections: string[] = [];
  if (newAlerts.length > 0) {
    sections.push(
      ['**新告警**:', ...newAlerts.map((c) => `- ${c.label}: ${fmtValue(c.value, c.unit)} (阈值 ${fmtValue(c.threshold, c.unit)})`)].join('\n')
    );
  }
  if (recoveries.length > 0) {
    sections.push(
      ['**已恢复**:', ...recoveries.map((c) => `- ${c.label}: ${fmtValue(c.value, c.unit)} 回到阈值以下`)].join('\n')
    );
  }
  sections.push(snapshotBlock(sample, checks));

  return {
    summary,
    message: {
      title,
      content: sections.join('\n\n'),
      level: isWarn ? 'warn' : 'info',
    },
  };
}

export interface RunPollOptions {
  intervalSec: number;
  config: MonitorConfig;
  signal: { stopped: boolean };
  /** 便于测试注入 */
  collector?: () => Promise<SystemSample>;
  /** 便于测试注入 */
  notifiersOverride?: Notifier[];
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

async function dispatch(
  notifiers: Notifier[],
  msg: NotifierMessage,
  logError: (line: string) => void
): Promise<void> {
  const results = await Promise.allSettled(notifiers.map((n) => n.send(msg)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logError(`通道 ${notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));
  const collector = options.collector ?? (() => collectSample({ disks: options.config.disks }));
  const fsm = new MetricStateMachine();

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      const sample = await collector();
      const { summary, message } = buildTickMessage(sample, options.config, fsm);
      logLine(summary);
      if (message) {
        await dispatch(notifiers, message, logError);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] tick 失败: ${msg}`);
    }
  };

  await tick();
  const handle = setInterval(() => {
    if (options.signal.stopped) {
      clearInterval(handle);
      return;
    }
    void tick();
  }, options.intervalSec * 1000);
}
