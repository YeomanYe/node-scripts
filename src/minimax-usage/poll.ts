import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';
import { PollConfig } from './config';
import { formatLocalTime, formatModelLine } from './format';
import { MiniMaxQuotaSnapshot } from './types';

export interface PollReport extends NotifierMessage {
  summaryLine: string;
}

function hasLowQuota(snapshot: MiniMaxQuotaSnapshot): boolean {
  return snapshot.models.some((model) => {
    const values = [
      model.interval.remainingPercent,
      model.weekly.remainingPercent,
    ].filter((v): v is number => typeof v === 'number');
    return values.some((v) => v <= 20);
  });
}

export function buildPollReport(snapshot: MiniMaxQuotaSnapshot, nowMs = Date.now()): PollReport {
  const lowQuota = hasLowQuota(snapshot);
  const title = lowQuota ? '🚨 MiniMax 用量告警' : '📊 MiniMax 用量报告';
  const level: 'info' | 'warn' = lowQuota ? 'warn' : 'info';
  const content = [
    `**当前时间**：${formatLocalTime(nowMs)}`,
    '',
    ...(snapshot.models.length > 0 ? snapshot.models.map(formatModelLine) : ['未返回模型用量数据']),
  ].join('\n');
  const summaryLine = snapshot.models.length > 0
    ? snapshot.models
        .map((model) => {
          const interval = model.interval.remainingPercent;
          const weekly = model.weekly.remainingPercent;
          return `${model.modelName}:interval=${interval ?? '?'} weekly=${weekly ?? '?'}`;
        })
        .join(' ')
    : 'empty';

  return { title, content, level, summaryLine };
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
  fetcher: () => Promise<MiniMaxQuotaSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot);
  options.logLine(`[${new Date().toISOString()}] ${report.summaryLine}`);

  const results = await Promise.allSettled(
    options.notifiers.map((n) =>
      n.send({ title: report.title, content: report.content, level: report.level })
    )
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      options.logError(`通道 ${options.notifiers[index]?.name ?? index} 发送失败: ${reason}`);
    }
  });
}

export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((line) => process.stdout.write(line + '\n'));
  const logError = options.logError ?? ((line) => process.stderr.write(line + '\n'));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        fetcher: options.fetcher,
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
