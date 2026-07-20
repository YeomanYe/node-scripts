/**
 * llm-tail-burn 的 daemon 主循环。
 *
 * 每个 task 在自己的窗口尾部独立 burn：
 *   1. 对 task 的每个 agent 拉对应 provider 的 snapshot → meta
 *   2. evaluateAgent(agent, meta) → 单 agent 决策
 *   3. combineDecisions(decisions, match) → task 决策
 *   4. 未到触发时间 → sleep 到 trigger (封顶 loopMaxSleep)
 *   5. 到点且决策为 burn → 循环执行 task，每次之间 cooldown
 *   6. 停止条件：windowDone / maxIterations / stopOnError
 *   7. 窗口切换后重置计数，继续下一轮
 */

import { RegisteredTask } from '../llm-gated-run/config';
import { runRegisteredTask } from '../llm-gated-run/runner';
import { WindowProvider } from '../llm-window-runner/config';
import { ResolveAnchorOptions, resolveWindowAnchor } from '../llm-window-runner/windows';
import { BurnAgent, BurnRunnerConfig, BurnTask } from './config';
import {
  AgentDecision,
  CombinedBurnDecision,
  combineDecisions,
  planProjection,
  planRate,
  planTail,
} from './schedule';

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
  decision: CombinedBurnDecision;
  agents: AgentDecision[];
}

interface TaskState {
  /** 当前 burn 的窗口结束时间，跨轮识别同一窗口（取所有 agent 中最早） */
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

function effectiveProvider(provider: WindowProvider, windowOverride?: string): WindowProvider {
  if (!windowOverride) return provider;
  return { ...provider, window: windowOverride } as WindowProvider;
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

async function evaluateAgent(
  agent: BurnAgent,
  providers: Record<string, WindowProvider>,
  opts: ResolveAnchorOptions,
  nowMs: number
): Promise<AgentDecision> {
  const provider = providers[agent.provider];
  if (!provider) throw new Error(`agent.provider 未注册：${agent.provider}`);
  const effShort = effectiveProvider(provider, agent.window);

  switch (agent.kind) {
    case 'tail': {
      const { meta } = await resolveWindowAnchor(effShort, opts);
      return planTail({
        meta,
        leadTimeSeconds: agent.leadTimeSeconds,
        minRemainingPercent: agent.minRemainingPercent,
        nowMs,
      });
    }
    case 'rate': {
      const { meta } = await resolveWindowAnchor(effShort, opts);
      return planRate({
        meta,
        ratePerHour: agent.ratePerHour,
        nowMs,
      });
    }
    case 'projection': {
      const pairedProvider = providers[agent.pairedProvider];
      if (!pairedProvider) throw new Error(`agent.pairedProvider 未注册：${agent.pairedProvider}`);
      const effLong = effectiveProvider(pairedProvider, agent.pairedWindow);
      const [{ meta: shortMeta }, { meta: longMeta }] = await Promise.all([
        resolveWindowAnchor(effShort, opts),
        resolveWindowAnchor(effLong, opts),
      ]);
      return planProjection({
        shortMeta,
        longMeta,
        shortWindowConsumePercent: agent.shortWindowConsumePercent,
        nowMs,
      });
    }
    default:
      throw new Error(`不支持的 agent.kind：${(agent as { kind: string }).kind}`);
  }
}

async function runTaskLoop(
  taskName: string,
  task: BurnTask,
  providers: Record<string, WindowProvider>,
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
    `task=${taskName} loop started (match=${task.match}, agents=${task.agents.length}, maxIter=${task.maxIterations || '∞'})`
  );

  while (!opts.signal.stopped) {
    const nowMs = now();

    if (nowMs < state.backoffUntilMs) {
      await sleep(Math.min(state.backoffUntilMs - nowMs, maxSleepMs));
      continue;
    }

    let decision: CombinedBurnDecision;
    try {
      const agentDecisions: AgentDecision[] = [];
      for (const agent of task.agents) {
        agentDecisions.push(await evaluateAgent(agent, providers, opts, nowMs));
      }
      decision = combineDecisions(agentDecisions, task.match);
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
      if (decision.triggerMs != null && nowMs < decision.triggerMs) {
        sleepMs = Math.min(decision.triggerMs - nowMs, maxSleepMs);
      } else {
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
    return runTaskLoop(name, task, opts.config.providers, opts);
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
  const agents: AgentDecision[] = [];
  for (const agent of task.agents) {
    agents.push(await evaluateAgent(agent, config.providers, options, nowMs));
  }
  const decision = combineDecisions(agents, task.match);
  return { taskName, decision, agents };
}
