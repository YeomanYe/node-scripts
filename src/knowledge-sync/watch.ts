/**
 * 防抖运行器：把突发的文件系统事件（以及兜底轮询）合并成一次同步执行。
 *
 * 设计目标（核心可测单元，与 fs.watch 解耦）：
 * - `trigger()` 会（重新）启动防抖计时器，计时结束后跑一次 `runSync`；
 * - 保证不会并发：若已有一次 run 在执行中，期间到来的 trigger 只会在当前 run
 *   结束后再补跑一次（coalesce），永远不会出现两次并发；
 * - `runSync` 抛错会被吞掉并交给 `onError`，watcher 不会因为一次同步失败而退出；
 * - 可停止（`stop()`），停止后挂起的防抖 run 不会再触发，并可 `whenIdle()` 等待
 *   in-flight run 收尾。
 *
 * 计时器通过 `timer` 注入，测试可用 fake timers / 受控时钟替换真实 setTimeout。
 */

export interface DebounceTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimer: DebounceTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface DebouncedRunnerOptions {
  runSync: () => Promise<void> | void;
  debounceMs: number;
  timer?: DebounceTimer;
  onError?: (error: unknown) => void;
}

export class DebouncedRunner {
  private readonly runSync: () => Promise<void> | void;
  private readonly debounceMs: number;
  private readonly timer: DebounceTimer;
  private readonly onError: (error: unknown) => void;

  private timerHandle: unknown = null;
  private running = false;
  /** in-flight run 期间又来了 trigger，需要在收尾后补跑一次。 */
  private pending = false;
  private stopped = false;
  private activeRun: Promise<void> | null = null;

  constructor(options: DebouncedRunnerOptions) {
    this.runSync = options.runSync;
    this.debounceMs = options.debounceMs;
    this.timer = options.timer ?? realTimer;
    this.onError = options.onError ?? (() => undefined);
  }

  /** 触发一次（重新）防抖；多次调用会合并成一次执行。 */
  trigger(): void {
    if (this.stopped) return;

    if (this.running) {
      // 当前正有一次 run 在跑，标记结束后补跑一次，不重启计时器（避免并发）。
      this.pending = true;
      return;
    }

    if (this.timerHandle !== null) {
      this.timer.clear(this.timerHandle);
    }
    this.timerHandle = this.timer.set(() => {
      this.timerHandle = null;
      void this.execute();
    }, this.debounceMs);
  }

  private async execute(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    const run = (async () => {
      try {
        await this.runSync();
      } catch (error) {
        this.onError(error);
      }
    })();
    this.activeRun = run;
    await run;
    this.running = false;
    this.activeRun = null;

    // 执行期间又来了 trigger：补跑一次（同样走防抖，保持 coalesce 语义）。
    if (!this.stopped && this.pending) {
      this.pending = false;
      this.trigger();
    }
  }

  /** 停止：取消挂起的防抖 run，并阻止后续 trigger 生效。 */
  stop(): void {
    this.stopped = true;
    if (this.timerHandle !== null) {
      this.timer.clear(this.timerHandle);
      this.timerHandle = null;
    }
    this.pending = false;
  }

  /**
   * 等待当前 in-flight run（如果有）收尾，用于优雅退出。
   * 调用方在 `whenIdle()` 前总会先调 `stop()`（见 runWatch shutdown）：stop 后
   * `pending` 被清空且 `stopped` 阻止任何后续 trigger/补跑，故 in-flight run 结束后
   * 不会再产生新的 activeRun。最多只需 await 一次，用 `if` 而非 `while`。
   */
  async whenIdle(): Promise<void> {
    if (this.activeRun) {
      await this.activeRun;
    }
  }

  /** 仅供测试/诊断：是否有 run 正在执行。 */
  get isRunning(): boolean {
    return this.running;
  }
}
