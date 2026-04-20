import { getDefaultAuthPath, loadLocalAuth } from './auth';
import { getUsageSnapshot } from './usage';
import { UsageSnapshot, UsageWindow } from './types';
import { PollConfig, CodexAlertWindow } from './config';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';

interface WindowMeta {
  label: string;
  get: (s: UsageSnapshot) => UsageWindow | undefined;
}

const WINDOWS: Record<CodexAlertWindow, WindowMeta> = {
  primary: { label: 'Primary', get: (s) => s.primary },
  secondary: { label: 'Secondary', get: (s) => s.secondary },
};

export interface ReportOptions {
  windows: CodexAlertWindow[];
  nowMs: number;
}

export interface AlertEntry {
  window: CodexAlertWindow;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

export function buildPollReport(snapshot: UsageSnapshot, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const key of options.windows) {
    const meta = WINDOWS[key];
    const win = meta.get(snapshot);
    if (!win) continue;

    if (!win.windowMinutes || win.windowMinutes <= 0) {
      lines.push(`  ${meta.label}：${win.usedPercent.toFixed(1)}% ｜windowMinutes 未知，跳过告警判定`);
      continue;
    }

    const result = checkProrated({
      utilization: win.usedPercent,
      resetsAtMs: (win.resetsAt ?? 0) * 1000,
      windowMs: win.windowMinutes * 60_000,
      nowMs: options.nowMs,
    });

    entries.push({ window: key, label: meta.label, utilization: win.usedPercent, result });

    const prefix = result.breached ? '🚨' : '  ';
    const diffLabel = result.breached
      ? `超 ${result.overBy.toFixed(1)}pp`
      : `差 ${result.overBy.toFixed(1)}pp`;
    lines.push(
      `${prefix} ${meta.label}：${win.usedPercent.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}`
    );
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 Codex 用量告警' : '📊 Codex 用量报告';
  const header = `**Plan**：${snapshot.planType}`;
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
  authFile?: string;
  baseUrl?: string;
  fetcher?: () => Promise<UsageSnapshot>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

async function defaultFetcher(authFile: string, baseUrl: string): Promise<UsageSnapshot> {
  const auth = await loadLocalAuth(authFile);
  return getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    baseUrl,
  });
}

export async function runOnce(options: {
  config: PollConfig;
  fetcher: () => Promise<UsageSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot, {
    windows: options.config.alert.windows,
    nowMs: Date.now(),
  });
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
  const authFile = options.authFile ?? getDefaultAuthPath();
  const baseUrl = options.baseUrl ?? 'https://chatgpt.com/backend-api';
  const fetcher = options.fetcher ?? (() => defaultFetcher(authFile, baseUrl));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        config: options.config,
        fetcher,
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
  handle.unref();
}
