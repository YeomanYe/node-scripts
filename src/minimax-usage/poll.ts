import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { MiniMaxAlertWindow, PollConfig } from './config';
import { formatLocalTime } from './format';
import { MiniMaxModelQuota, MiniMaxQuotaWindow, MiniMaxQuotaSnapshot } from './types';

interface WindowMeta {
  label: string;
  get: (m: MiniMaxModelQuota) => MiniMaxQuotaWindow;
}

const WINDOWS: Record<MiniMaxAlertWindow, WindowMeta> = {
  interval: { label: '5小时', get: (m) => m.interval },
  weekly: { label: '周', get: (m) => m.weekly },
};

export interface ReportOptions {
  windows: MiniMaxAlertWindow[];
  nowMs: number;
}

export interface AlertEntry {
  window: MiniMaxAlertWindow;
  model: string;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

export function buildPollReport(snapshot: MiniMaxQuotaSnapshot, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const model of snapshot.models) {
    for (const key of options.windows) {
      const meta = WINDOWS[key];
      const win = meta.get(model);
      const resetLabel = win.endMs !== null && win.endMs > 0 ? ` ｜结束 ${formatLocalTime(win.endMs)}` : '';
      const utilization = win.usedPercent ?? 0;
      const windowMs = win.endMs !== null && win.startMs !== null ? win.endMs - win.startMs : null;

      if (windowMs === null || windowMs <= 0) {
        lines.push(`  ${model.modelName} ${meta.label}：${utilization.toFixed(1)}% ｜窗口时长未知，跳过告警判定${resetLabel}`);
        continue;
      }

      const result = checkProrated({
        utilization,
        resetsAtMs: win.endMs ?? 0,
        windowMs,
        nowMs: options.nowMs,
      });
      entries.push({ window: key, model: model.modelName, label: meta.label, utilization, result });

      const prefix = result.breached ? '🚨' : '  ';
      const diffLabel = result.breached ? `超 ${result.overBy.toFixed(1)}pp` : `差 ${result.overBy.toFixed(1)}pp`;
      lines.push(`${prefix} ${model.modelName} ${meta.label}：${utilization.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}${resetLabel}`);
    }
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 MiniMax 用量告警' : '📊 MiniMax 用量报告';
  const plan = snapshot.planName ? `**套餐**：${snapshot.planName} ｜ ` : '';
  const header = `${plan}**当前时间**：${formatLocalTime(options.nowMs)}`;
  const content = [header, '', ...(lines.length > 0 ? lines : ['未返回模型用量数据'])].join('\n');

  const summaryLine =
    entries
      .map((e) => `${e.model}.${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`)
      .join(' ') + ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  fetcher: () => Promise<MiniMaxQuotaSnapshot>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

export async function runOnce(options: {
  config: PollConfig;
  fetcher: () => Promise<MiniMaxQuotaSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot, { windows: options.config.alert.windows, nowMs: Date.now() });
  options.logLine(`[${new Date().toISOString()}] ${report.summaryLine}`);

  const results = await Promise.allSettled(
    options.notifiers.map((n) => n.send({ title: report.title, content: report.content, level: report.level }))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      options.logError(`通道 ${options.notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({ config: options.config, fetcher: options.fetcher, notifiers, logLine, logError });
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
