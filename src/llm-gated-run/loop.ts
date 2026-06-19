import { DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE } from '../minimax-usage/env';
import { fetchMiniMaxQuota } from '../minimax-usage/quota';
import { MiniMaxQuotaSnapshot } from '../minimax-usage/types';
import { GatedRunConfig, ProviderConfig, RegisteredTask, SchedulerConfig, resolveProviderApiKey } from './config';
import { evaluateMiniMaxGate, GateDecision } from './gate';
import { runRegisteredTask, RunTaskResult } from './runner';

export interface LoopRuntimeOptions {
  config: GatedRunConfig;
  envFile: string;
  apiKeyEnv: string;
  signal: { stopped: boolean };
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
  runner?: (task: RegisteredTask) => Promise<RunTaskResult>;
  snapshotFetcher?: (provider: ProviderConfig) => Promise<MiniMaxQuotaSnapshot>;
  random?: () => number;
}

const DEFAULT_SCHEDULER: SchedulerConfig = {
  mode: 'sequence',
  runImmediately: true,
  intervalSeconds: 900,
  jitterSeconds: 0,
  stopOnError: false,
};

function timestamp(): string {
  return new Date().toISOString();
}

async function fetchProviderSnapshot(provider: ProviderConfig, options: {
  envFile: string;
  apiKeyEnv: string;
}): Promise<MiniMaxQuotaSnapshot> {
  if (provider.type === 'minimax') {
    // 每个 provider 用自己的 api key,缺省回退全局 loop 选项
    const apiKey = await resolveProviderApiKey(provider, {
      envFile: options.envFile,
      apiKeyEnv: options.apiKeyEnv,
    });
    return fetchMiniMaxQuota({ apiKey });
  }
  throw new Error(`未知 provider: ${(provider as { type: string }).type}`);
}

function evaluateTask(provider: ProviderConfig, task: RegisteredTask, snapshot: MiniMaxQuotaSnapshot): GateDecision {
  if (provider.type === 'minimax') {
    return evaluateMiniMaxGate({
      snapshot,
      model: task.model ?? provider.model,
      window: task.window ?? provider.window,
      minHeadroomPercent: task.minHeadroomPercent ?? provider.minHeadroomPercent,
      allowOnUnknownQuota: provider.allowOnUnknownQuota,
    });
  }
  throw new Error(`未知 provider: ${(provider as { type: string }).type}`);
}

function mergeScheduler(provider: ProviderConfig): SchedulerConfig {
  return {
    ...DEFAULT_SCHEDULER,
    ...(provider.scheduler ?? {}),
  };
}

async function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  const end = Date.now() + ms;
  while (!signal.stopped) {
    const remaining = end - Date.now();
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 1_000)));
  }
}

async function runProviderRound(options: {
  providerId: string;
  provider: ProviderConfig;
  scheduler: SchedulerConfig;
  config: GatedRunConfig;
  envFile: string;
  apiKeyEnv: string;
  signal: { stopped: boolean };
  logLine: (line: string) => void;
  logError: (line: string) => void;
  runner: (task: RegisteredTask) => Promise<RunTaskResult>;
  snapshotFetcher?: (provider: ProviderConfig) => Promise<MiniMaxQuotaSnapshot>;
}): Promise<boolean> {
  options.logLine(`[${timestamp()}] provider=${options.providerId} round started (${options.provider.tasks.length} tasks)`);

  for (const taskName of options.provider.tasks) {
    if (options.signal.stopped) return false;
    const task = options.config.tasks[taskName];
    if (!task) {
      options.logError(`[${timestamp()}] provider=${options.providerId} task=${taskName} 未注册`);
      if (options.scheduler.stopOnError) return false;
      continue;
    }

    try {
      const snapshot = options.snapshotFetcher
        ? await options.snapshotFetcher(options.provider)
        : await fetchProviderSnapshot(options.provider, {
            envFile: options.envFile,
            apiKeyEnv: options.apiKeyEnv,
          });
      const decision = evaluateTask(options.provider, task, snapshot);
      const model = decision.modelName ? ` model=${decision.modelName}` : '';
      options.logLine(
        `[${timestamp()}] provider=${options.providerId} task=${taskName}${model} window=${decision.window} ${decision.reason}`
      );

      if (!decision.allowed) continue;

      const result = await options.runner(task);
      if (result.code !== 0) {
        options.logError(`[${timestamp()}] provider=${options.providerId} task=${taskName} 失败 exit=${result.code}`);
        if (options.scheduler.stopOnError) return false;
      } else {
        options.logLine(`[${timestamp()}] provider=${options.providerId} task=${taskName} completed`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      options.logError(`[${timestamp()}] provider=${options.providerId} task=${taskName} 执行异常: ${message}`);
      if (options.scheduler.stopOnError) return false;
    }
  }

  options.logLine(`[${timestamp()}] provider=${options.providerId} round completed`);
  return true;
}

export async function runProviderLoop(options: LoopRuntimeOptions & {
  providerId: string;
  provider: ProviderConfig;
}): Promise<void> {
  const logLine = options.logLine ?? ((line) => process.stdout.write(line + '\n'));
  const logError = options.logError ?? ((line) => process.stderr.write(line + '\n'));
  const runner = options.runner ?? runRegisteredTask;
  const snapshotFetcher = options.snapshotFetcher;
  const random = options.random ?? Math.random;
  const scheduler = mergeScheduler(options.provider);

  if (scheduler.mode !== 'sequence') {
    throw new Error(`provider=${options.providerId} scheduler.mode 目前只支持 sequence`);
  }

  let first = true;
  while (!options.signal.stopped) {
    if (first) {
      first = false;
      if (!scheduler.runImmediately) {
        const initialDelay = scheduler.intervalSeconds * 1000;
        logLine(`[${timestamp()}] provider=${options.providerId} waits ${scheduler.intervalSeconds}s before first round`);
        await sleep(initialDelay, options.signal);
        if (options.signal.stopped) return;
      }
    }

    const shouldContinue = await runProviderRound({
      providerId: options.providerId,
      provider: options.provider,
      scheduler,
      config: options.config,
      envFile: options.envFile,
      apiKeyEnv: options.apiKeyEnv,
      signal: options.signal,
      logLine,
      logError,
      runner,
      snapshotFetcher,
    });
    if (!shouldContinue) return;

    const jitterMs = scheduler.jitterSeconds > 0
      ? Math.floor(random() * scheduler.jitterSeconds * 1000)
      : 0;
    const delayMs = scheduler.intervalSeconds * 1000 + jitterMs;
    logLine(
      `[${timestamp()}] provider=${options.providerId} next round in ${Math.round(delayMs / 1000)}s`
    );
    await sleep(delayMs, options.signal);
  }
}

export async function runProviderLoops(options: LoopRuntimeOptions): Promise<void> {
  const entries = Object.entries(options.config.providers).filter(([, provider]) => provider.tasks.length > 0);
  if (entries.length === 0) {
    throw new Error('没有可循环执行的 provider：请在 providers.<name>.tasks 配置任务列表');
  }

  await Promise.all(
    entries.map(([providerId, provider]) =>
      runProviderLoop({
        ...options,
        providerId,
        provider,
      })
    )
  );
}

export const DEFAULT_LOOP_ENV_FILE = DEFAULT_ENV_FILE;
export const DEFAULT_LOOP_API_KEY_ENV = DEFAULT_API_KEY_ENV;
