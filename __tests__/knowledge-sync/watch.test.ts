import { DebouncedRunner, type DebounceTimer } from '../../src/knowledge-sync/watch';

/**
 * 受控时钟：替换真实 setTimeout，让测试可以确定性地推进时间。
 * 只支持本测试需要的单计时器语义（DebouncedRunner 同一时刻最多挂一个防抖计时器）。
 */
class FakeClock implements DebounceTimer {
  private handles = new Map<number, { callback: () => void; fireAt: number }>();
  private nextId = 1;
  private now = 0;

  set(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.handles.set(id, { callback, fireAt: this.now + ms });
    return id;
  }

  clear(handle: unknown): void {
    this.handles.delete(handle as number);
  }

  /** 推进时间，触发所有到点的计时器。 */
  advance(ms: number): void {
    this.now += ms;
    for (const [id, entry] of [...this.handles.entries()]) {
      if (entry.fireAt <= this.now) {
        this.handles.delete(id);
        entry.callback();
      }
    }
  }
}

/** 让微任务队列清空（runSync 是 async，需要等其 promise 链跑完）。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('DebouncedRunner', () => {
  it('coalesces multiple triggers within the debounce window into one run', async () => {
    const clock = new FakeClock();
    let runs = 0;
    const runner = new DebouncedRunner({
      runSync: () => { runs += 1; },
      debounceMs: 100,
      timer: clock,
    });

    runner.trigger();
    clock.advance(40);
    runner.trigger();
    clock.advance(40);
    runner.trigger();
    expect(runs).toBe(0);

    clock.advance(100);
    await flushMicrotasks();
    expect(runs).toBe(1);
  });

  it('queues exactly one coalesced run when triggered during an in-flight run (no overlap)', async () => {
    const clock = new FakeClock();
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const runner = new DebouncedRunner({
      runSync: async () => {
        runs += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (runs === 1) {
          await firstGate; // 第一次 run 卡住，模拟 in-flight
        }
        concurrent -= 1;
      },
      debounceMs: 50,
      timer: clock,
    });

    runner.trigger();
    clock.advance(50);
    await flushMicrotasks();
    expect(runner.isRunning).toBe(true);

    // in-flight 期间连续多次 trigger —— 应只补跑一次
    runner.trigger();
    runner.trigger();
    runner.trigger();
    expect(maxConcurrent).toBe(1);

    releaseFirst();
    await flushMicrotasks();
    // 补跑那次同样走防抖
    clock.advance(50);
    await flushMicrotasks();

    expect(runs).toBe(2);
    expect(maxConcurrent).toBe(1);
  });

  it('does not crash when runSync throws and still runs on a later trigger', async () => {
    const clock = new FakeClock();
    const errors: unknown[] = [];
    let runs = 0;
    const runner = new DebouncedRunner({
      runSync: async () => {
        runs += 1;
        if (runs === 1) throw new Error('boom');
      },
      debounceMs: 50,
      timer: clock,
      onError: (error) => { errors.push(error); },
    });

    runner.trigger();
    clock.advance(50);
    await flushMicrotasks();
    expect(runs).toBe(1);
    expect(errors).toHaveLength(1);

    // 一次失败不应让 runner 卡死
    runner.trigger();
    clock.advance(50);
    await flushMicrotasks();
    expect(runs).toBe(2);
  });

  it('stop() prevents a pending debounced run from firing', async () => {
    const clock = new FakeClock();
    let runs = 0;
    const runner = new DebouncedRunner({
      runSync: () => { runs += 1; },
      debounceMs: 100,
      timer: clock,
    });

    runner.trigger();
    clock.advance(50);
    runner.stop();
    clock.advance(100);
    await flushMicrotasks();
    expect(runs).toBe(0);

    // stop 之后的 trigger 也不生效
    runner.trigger();
    clock.advance(100);
    await flushMicrotasks();
    expect(runs).toBe(0);
  });
});
