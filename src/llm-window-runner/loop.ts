/**
 * llm-window-runner 的 daemon 主循环。
 *
 * 每轮：
 *   1. 对每个 task 拉对应 provider 的 snapshot → WindowAnchor
 *   2. 算 trigger (今天的 HH:MM 或明天的；同一天不重复 fire)
 *   3. findNearestStart(anchor, trigger, now) → fireAtMs
 *   4. 选最早的 fireAt，sleep 到那时 (封顶 loopMaxSleepSeconds)
 *   5. 醒来后：对每个在 tolerance 内到点的 task 执行
 */

import { runRegisteredTask } from '../llm-gated-run/runner';
import { WindowProvider, WindowRunnerConfig, WindowTask } from './config';
import { findNearestStart, nextConfiguredTrigger } from './schedule';
import { ResolveAnchorOptions, resolveWindowAnchor } from './windows';

export interface LoopOptions extends ResolveAnchorOptions {
  config: WindowRunnerConfig;
  signal: { stopped: boolean };
  /** 注入点：方便测试 (默认 setTimeout) */
  sleep?: (ms: number) => Promise<void>;
  /** 注入点：方便测试 (默认 Date.now()) */
  now?: () => number;
  /** 注入点：每个任务的执行 (默认 runRegisteredTask) */
  runTask?: (task: WindowTask) => Promise<{ code: number }>;
}

interface TaskState {
  /** 上一次被执行的 schedule key (YYYY-MM-DD)，用于避免同日重复 fire */
  lastCoveredScheduleKey: string | null;
  /** 上次拉取错误时的退避截止时间 (ms)，在此之前跳过本任务 */
  backoffUntilMs: number;
}

interface ComputedSlot {
  taskName: string;
  task: WindowTask;
  fireAtMs: number;
  triggerMs: number;
  scheduleKey: string;
  meta: Record<string, unknown>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateKey(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

/** 给定一个 trigger Date，如果它的日期已经被覆盖，往后推 1 天 */
function adjustTrigger(triggerMs: number, lastCoveredKey: string | null): number {
  if (!lastCoveredKey) return triggerMs;
  if (dateKey(triggerMs) !== lastCoveredKey) return triggerMs;
  const next = new Date(triggerMs);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function computeSlot(
  taskName: string,
  task: WindowTask,
  provider: WindowProvider,
  state: TaskState,
  nowMs: number,
  options: ResolveAnchorOptions
): Promise<ComputedSlot> {
  const { anchor, meta } = await resolveWindowAnchor(provider, options);
  const baseTrigger = nextConfiguredTrigger(task.scheduledTime, new Date(nowMs)).getTime();
  const trigger = adjustTrigger(baseTrigger, state.lastCoveredScheduleKey);
  const result = findNearestStart(anchor, trigger, nowMs);
  return {
    taskName,
    task,
    fireAtMs: result.fireAtMs,
    triggerMs: trigger,
    scheduleKey: dateKey(trigger),
    meta: { ...meta, deltaMs: result.deltaMs, fallback: result.fallback },
  };
}

function logLine(message: string): void {
  process.stdout.write(`[${new Date().toISOString()}] [llm-window-runner] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] [llm-window-runner] ${message}\n`);
}

export async function runWindowRunnerLoop(opts: LoopOptions): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const runTask = opts.runTask ?? ((task) => runRegisteredTask({
    provider: undefined,
    cmd: task.cmd,
    command: task.command,
    args: task.args,
    cwd: task.cwd,
    env: task.env,
    shell: task.shell,
    model: undefined,
    window: undefined,
    minHeadroomPercent: undefined,
  }));
  const config = opts.config;

  const states = new Map<string, TaskState>();
  for (const name of Object.keys(config.tasks)) {
    states.set(name, { lastCoveredScheduleKey: null, backoffUntilMs: 0 });
  }

  logLine(
    `loop started (tasks=${Object.keys(config.tasks).length}, providers=${Object.keys(config.providers).length})`
  );

  while (!opts.signal.stopped) {
    const nowMs = now();

    // 1. compute slots
    const slots: ComputedSlot[] = [];
    for (const [taskName, task] of Object.entries(config.tasks)) {
      const state = states.get(taskName)!;
      if (nowMs < state.backoffUntilMs) continue;
      const provider = config.providers[task.provider];
      if (!provider) {
        logError(`task ${taskName} 引用了未知 provider=${task.provider}，跳过`);
        continue;
      }
      try {
        const slot = await computeSlot(taskName, task, provider, state, nowMs, opts);
        slots.push(slot);
        logLine(
          `task=${taskName} trigger=${isoTime(slot.triggerMs)} fire=${isoTime(slot.fireAtMs)} delta=${slot.meta['deltaMs']}ms`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.backoffUntilMs = nowMs + config.loopBackoffSeconds * 1000;
        logError(
          `task=${taskName} 计算 anchor 失败：${message}；退避 ${config.loopBackoffSeconds}s`
        );
      }
    }

    if (opts.signal.stopped) break;

    // 2. 没有可调度任务 → 睡到 backoff 时刻或 loopMaxSleep
    if (slots.length === 0) {
      const sleepMs = config.loopMaxSleepSeconds * 1000;
      logLine(`无可调度 task，睡 ${Math.round(sleepMs / 1000)}s`);
      await sleep(sleepMs);
      continue;
    }

    // 3. 选最早 fireAt
    slots.sort((a, b) => a.fireAtMs - b.fireAtMs);
    const earliest = slots[0]!;
    const sleepMs = Math.max(0, Math.min(earliest.fireAtMs - now(), config.loopMaxSleepSeconds * 1000));
    if (sleepMs > 0) {
      logLine(`等待最早 fire (task=${earliest.taskName}) 共 ${Math.round(sleepMs / 1000)}s`);
      await sleep(sleepMs);
    }

    if (opts.signal.stopped) break;

    // 4. 醒来 → 找所有在 tolerance 内到点的 task 并执行
    const wakeMs = now();
    const tol = config.fireToleranceMs;
    // 串行执行，避免并发导致的额度抖动
    for (const slot of slots) {
      if (opts.signal.stopped) break;
      const dist = wakeMs - slot.fireAtMs;
      if (dist < -tol) continue; // 还没到
      if (dist > tol * 5) {
        // 错过太久，跳过本轮，下一轮重算 (避免误伤"远在窗口外的远期 fire")
        continue;
      }
      const state = states.get(slot.taskName)!;
      logLine(`fire task=${slot.taskName} scheduled=${slot.scheduleKey} dist=${dist}ms`);
      try {
        const { code } = await runTask(slot.task);
        logLine(`task=${slot.taskName} 完成 exit=${code}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`task=${slot.taskName} 执行失败：${message}`);
      }
      state.lastCoveredScheduleKey = slot.scheduleKey;
    }

    // 5. 最小冷却避免抖动
    if (!opts.signal.stopped && config.loopMinCooldownSeconds > 0) {
      await sleep(config.loopMinCooldownSeconds * 1000);
    }
  }

  logLine('loop stopped');
}

/** 给 list/next 命令复用：算一次 slot (不执行) */
export async function computeSlotForCli(
  taskName: string,
  config: WindowRunnerConfig,
  options: ResolveAnchorOptions,
  nowMs: number = Date.now()
): Promise<ComputedSlot> {
  const task = config.tasks[taskName];
  if (!task) throw new Error(`未注册任务：${taskName}`);
  const provider = config.providers[task.provider];
  if (!provider) throw new Error(`task=${taskName} 引用了未知 provider=${task.provider}`);
  const state: TaskState = { lastCoveredScheduleKey: null, backoffUntilMs: 0 };
  return computeSlot(taskName, task, provider, state, nowMs, options);
}
