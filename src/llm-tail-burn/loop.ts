/**
 * llm-tail-burn 的 daemon 主循环。
 *
 * 每个 task 在自己的窗口尾部独立 burn：
 *   1. 拉对应 provider 的 snapshot → meta
 *   2. planBurn(meta, task, now) → 判定是否 burn
 *   3. 未到触发时间 → sleep 到 trigger (封顶 loopMaxSleep)
 *   4. 到点且额度足够 → 循环执行 task，每次之间 cooldown
 *   5. 停止条件：窗口结束 / 额度不足 / maxIterations / stopOnError
 *   6. 窗口切换后重置计数，继续下一轮
 */

import { RegisteredTask } from '../llm-gated-run/config';
import { runRegisteredTask } from '../llm-gated-run/runner';
import { WindowProvider } from '../llm-window-runner/config';
import { ResolveAnchorOptions, resolveWindowAnchor } from '../llm-window-runner/windows';
import { BurnRunnerConfig, BurnTask } from './config';
import { BurnDecision, planBurn } from './schedule';

export interface BurnLoopOptions extends ResolveAnchorOptions {
  config: BurnRunnerConfig;
  signal: { stopped: boolean };
  /** 注入点：方便测试 (默认 setTimeout) */
  sleep?: (ms: number) => Promise<void>;
  /** 注入点：方便测试 (默认 Date.now()) */
  now?: () => number;
  /** 注入点：每个任务的执行 (默认 runRegisteredTask) */
  runTask?: (task: BurnTask) => Promise<{ code: number }>;
}

export interface BurnPreview {
  taskName: string;
  decision: BurnDecision;
  meta: Record<string, unknown>;
}

interface TaskState {
  /** 当前 burn 的窗口结束时间，跨轮识别同一窗口 */
  currentWindowEndMs: number | null;
  /** 当前窗口已 burn 次数 */
  burnCount: number;
  /** 当前窗口是否已完成 burn（达上限/出错），等下个窗口 */
  windowDone: boolean;
  /** 退避截止时间 (ms) */
  backoffUntilMs: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

function logLine(message: string): void {
  process.stdout.write(`[${new Date().toISOString()}] [llm-tail-burn] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] [llm-tail-burn] ${message}\n`);
}

function effectiveProvider(provider: WindowProvider, taskWindow?: string): WindowProvider {
  if (!taskWindow) return provider;
  return { ...provider, window: taskWindow } as WindowProvider;
}

function toRegisteredTask(task: BurnTask): RegisteredTask {
  return {
    cmd: task.cmd,
    command: task.command,
    args: task.args,
    cwd: task.cwd,
    env: task.env,
    shell: task.shell,
  };
}

async function runTaskLoop(
  taskName: string,
  task: BurnTask,
  provider: WindowProvider,
  opts: BurnLoopOptions
): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const runTask = opts.runTask ?? ((t) => runRegisteredTask(toRegisteredTask(t)));
  const maxSleepMs = opts.config.loopMaxSleepSeconds * 1000;
  const state: TaskState = {
    currentWindowEndMs: null,
    burnCount: 0,
    windowDone: false,
    backoffUntilMs: 0,
  };

  logLine(
    `task=${taskName} loop started (provider=${task.provider}${task.window ? `.${task.window}` : ''}, lead=${task.leadTimeSeconds}s, minRemain=${task.minRemainingPercent}%, maxIter=${task.maxIterations || '∞'})`
  );

  while (!opts.signal.stopped) {
    const nowMs = now();

    if (nowMs < state.backoffUntilMs) {
      await sleep(Math.min(state.backoffUntilMs - nowMs, maxSleepMs));
      continue;
    }

    let decision: BurnDecision;
    try {
      const eff = effectiveProvider(provider, task.window);
      const { meta } = await resolveWindowAnchor(eff, opts);
      decision = planBurn({
        meta,
        leadTimeSeconds: task.leadTimeSeconds,
        minRemainingPercent: task.minRemainingPercent,
        nowMs,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      state.backoffUntilMs = now() + opts.config.loopBackoffSeconds * 1000;
      logError(`task=${taskName} 拉取快照失败：${message}；退避 ${opts.config.loopBackoffSeconds}s`);
      await sleep(Math.min(opts.config.loopBackoffSeconds * 1000, maxSleepMs));
      continue;
    }

    // 窗口切换 → 重置状态
    if (state.currentWindowEndMs !== decision.windowEndMs) {
      if (state.currentWindowEndMs != null && state.burnCount > 0) {
        logLine(`task=${taskName} 上一窗口 burned ${state.burnCount} 次`);
      }
      state.currentWindowEndMs = decision.windowEndMs;
      state.burnCount = 0;
      state.windowDone = false;
    }

    if (!decision.burn) {
      let sleepMs: number;
      if (nowMs < decision.triggerMs) {
        sleepMs = Math.min(decision.triggerMs - nowMs, maxSleepMs);
      } else {
        // 窗口已结束（等下轮刷新）或额度不足
        sleepMs = maxSleepMs;
      }
      logLine(`task=${taskName} wait: ${decision.reason} (sleep ${Math.round(sleepMs / 1000)}s)`);
      await sleep(sleepMs);
      continue;
    }

    // decision.burn === true
    if (state.windowDone) {
      logLine(`task=${taskName} 本窗口 burn 已完成，等待新窗口`);
      await sleep(maxSleepMs);
      continue;
    }

    if (task.maxIterations > 0 && state.burnCount >= task.maxIterations) {
      state.windowDone = true;
      logLine(`task=${taskName} 达到 maxIterations=${task.maxIterations}，本窗口结束`);
      await sleep(maxSleepMs);
      continue;
    }

    const remainText = decision.remainingPercent != null ? `${decision.remainingPercent.toFixed(1)}%` : '?';
    logLine(
      `task=${taskName} fire burn #${state.burnCount + 1} remain=${remainText} end=${isoTime(decision.windowEndMs)}`
    );
    try {
      const { code } = await runTask(task);
      state.burnCount++;
      logLine(`task=${taskName} burn #${state.burnCount} 完成 exit=${code}`);
      if (code !== 0 && task.stopOnError) {
        state.windowDone = true;
        logError(`task=${taskName} 脚本非 0 退出 (exit=${code})，stopOnError → 本窗口结束`);
        await sleep(maxSleepMs);
        continue;
      }
    } catch (error: unknown) {
      state.burnCount++;
      const message = error instanceof Error ? error.message : String(error);
      logError(`task=${taskName} burn 执行异常：${message}`);
      if (task.stopOnError) {
        state.windowDone = true;
        await sleep(maxSleepMs);
        continue;
      }
    }

    // cooldown 后继续判定（额度可能已被消耗）
    if (!opts.signal.stopped && task.cooldownSeconds > 0) {
      await sleep(task.cooldownSeconds * 1000);
    }
  }

  logLine(`task=${taskName} loop stopped (burned ${state.burnCount} times this window)`);
}

export async function runBurnLoop(opts: BurnLoopOptions): Promise<void> {
  const taskNames = Object.keys(opts.config.tasks);
  logLine(
    `burn loop started (tasks=${taskNames.length}, providers=${Object.keys(opts.config.providers).length})`
  );

  const loops = taskNames.map((name) => {
    const task = opts.config.tasks[name];
    if (!task) return Promise.resolve();
    const provider = opts.config.providers[task.provider];
    if (!provider) {
      logError(`task=${name} 引用了未知 provider=${task.provider}，跳过`);
      return Promise.resolve();
    }
    return runTaskLoop(name, task, provider, opts);
  });

  await Promise.all(loops);
  logLine('burn loop stopped');
}

/** 给 list/next 命令复用：算一次预览 (不执行) */
export async function computeBurnPreview(
  taskName: string,
  config: BurnRunnerConfig,
  options: ResolveAnchorOptions,
  nowMs: number = Date.now()
): Promise<BurnPreview> {
  const task = config.tasks[taskName];
  if (!task) throw new Error(`未注册任务：${taskName}`);
  const provider = config.providers[task.provider];
  if (!provider) throw new Error(`task=${taskName} 引用了未知 provider=${task.provider}`);
  const eff = effectiveProvider(provider, task.window);
  const { meta } = await resolveWindowAnchor(eff, options);
  const decision = planBurn({
    meta,
    leadTimeSeconds: task.leadTimeSeconds,
    minRemainingPercent: task.minRemainingPercent,
    nowMs,
  });
  return { taskName, decision, meta };
}
