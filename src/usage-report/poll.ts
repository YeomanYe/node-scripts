import { buildNotifiers } from '../shared/notifiers';
import { AggregateConfig, ProviderOverrides } from './types';
import { CollectOptions, collectAllReports } from './collect';
import { buildAggregateCard } from './aggregate';

export interface RunOnceOptions {
  config: AggregateConfig;
  /** 可选：注入 collectOptions（如 fetchers），测试用 */
  collectOptions?: Partial<Omit<CollectOptions, 'providers' | 'nowMs'>>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}

/** 执行一次聚合轮询：collect 4 个 provider → 拼一张卡 → 一次性发送 */
export async function runOnce(options: RunOnceOptions): Promise<void> {
  const nowMs = Date.now();
  const results = await collectAllReports({
    providers: options.config.providers,
    nowMs,
    ...options.collectOptions,
  });
  const card = buildAggregateCard(results, { nowMs });
  options.logLine(`[${new Date().toISOString()}] ${card.summaryLine}`);

  const sendResults = await Promise.allSettled(
    options.notifiers.map((n) => n.send({ title: card.title, content: card.content, level: card.level }))
  );
  sendResults.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      options.logError(`通道 ${options.notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

export interface RunPollOptions {
  intervalSec: number;
  config: AggregateConfig;
  signal: { stopped: boolean };
  collectOptions?: Partial<Omit<CollectOptions, 'providers' | 'nowMs'>>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

/** 常驻轮询：立即跑一次，然后 setInterval 周期性 tick，SIGINT/SIGTERM 时停止 */
export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        config: options.config,
        collectOptions: options.collectOptions,
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

/** 将 AggregateConfig 的 providers 转成 collect 所需（CLI 注入用） */
export function toCollectProviders(config: AggregateConfig): ProviderOverrides {
  return config.providers;
}
