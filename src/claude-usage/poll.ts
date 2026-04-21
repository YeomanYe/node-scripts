import { getCredentials } from './credentials';
import { fetchUsage } from './api';
import { UsageData, ResetInfo } from './types';
import { PollConfig, ClaudeAlertWindow } from './config';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

interface WindowMeta {
  label: string;
  windowMs: number;
  get: (u: UsageData) => ResetInfo | null;
}

const WINDOWS: Record<ClaudeAlertWindow, WindowMeta> = {
  five_hour: {
    label: '5 小时',
    windowMs: FIVE_HOUR_MS,
    get: (u) => u.fiveHour,
  },
  seven_day: {
    label: '7 天',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDay,
  },
  seven_day_sonnet: {
    label: '7 天 Sonnet',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDaySonnet,
  },
  seven_day_opus: {
    label: '7 天 Opus',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDayOpus,
  },
};

function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface ReportOptions {
  windows: ClaudeAlertWindow[];
  nowMs: number;
  subscription: string;
  tier: string;
}

export interface AlertEntry {
  window: ClaudeAlertWindow;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

/** 构造单次轮询的通知消息 + 告警列表（纯函数，易测） */
export function buildPollReport(usage: UsageData, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const key of options.windows) {
    const meta = WINDOWS[key];
    const info = meta.get(usage);
    if (!info) continue;

    const resetMs = new Date(info.resetsAt).getTime();
    const result = checkProrated({
      utilization: info.utilization,
      resetsAtMs: resetMs,
      windowMs: meta.windowMs,
      nowMs: options.nowMs,
    });

    entries.push({ window: key, label: meta.label, utilization: info.utilization, result });

    const prefix = result.breached ? '🚨' : '  ';
    const diffLabel = result.breached
      ? `超 ${result.overBy.toFixed(1)}pp`
      : `差 ${result.overBy.toFixed(1)}pp`;
    const resetLabel = Number.isFinite(resetMs) && resetMs > 0 ? ` ｜结束 ${formatLocalTime(resetMs)}` : '';
    lines.push(
      `${prefix} ${meta.label}：${info.utilization.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}${resetLabel}`
    );
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 Claude 用量告警' : '📊 Claude 用量报告';

  const header = `**账号**：${options.subscription} ｜ **tier**：${options.tier} ｜ **当前时间**：${formatLocalTime(options.nowMs)}`;
  const content = [header, '', ...lines].join('\n');

  const summaryLine =
    entries
      .map((e) => `${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`)
      .join(' ') + ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  /** 便于测试注入，不传则使用真实 getCredentials/fetchUsage */
  fetcher?: () => Promise<{ usage: UsageData; subscription: string; tier: string }>;
  /** 便于测试注入 */
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  /** 默认 console.log */
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

async function defaultFetcher(): Promise<{ usage: UsageData; subscription: string; tier: string }> {
  const credentials = await getCredentials();
  const usage = await fetchUsage(credentials.accessToken);
  return { usage, subscription: credentials.subscriptionType, tier: credentials.rateLimitTier };
}

/** 执行一次轮询（抓取 + 构造报告 + 分发），被 runPoll 和测试共用 */
export async function runOnce(options: {
  config: PollConfig;
  fetcher?: RunPollOptions['fetcher'];
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const { usage, subscription, tier } = await fetcher();
  const report = buildPollReport(usage, {
    windows: options.config.alert.windows,
    nowMs: Date.now(),
    subscription,
    tier,
  });
  options.logLine(`[${new Date().toISOString()}] ${report.summaryLine}`);

  const results = await Promise.allSettled(
    options.notifiers.map((n) =>
      n.send({ title: report.title, content: report.content, level: report.level })
    )
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      options.logError(`通道 ${options.notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

/** 启动轮询；会立即跑一次，然后按 intervalSec 间隔继续 */
export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        config: options.config,
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        notifiers,
        logLine,
        logError,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] 轮询失败: ${message}`);
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
