import { WindowRunnerConfig } from '../../src/llm-window-runner/config';
import { runWindowRunnerLoop } from '../../src/llm-window-runner/loop';
import * as windowsMod from '../../src/llm-window-runner/windows';

const HOUR = 60 * 60 * 1000;
const FIVE_HOUR = 5 * HOUR;

function makeConfig(): WindowRunnerConfig {
  return {
    providers: {
      z: { type: 'zai', window: 'primary' },
    },
    tasks: {
      daily: {
        provider: 'z',
        scheduledTime: '06:00',
        cmd: 'echo hi',
        command: undefined,
        args: [],
        cwd: undefined,
        env: {},
        shell: true,
      },
    },
    loopMaxSleepSeconds: 600,
    loopMinCooldownSeconds: 0,
    loopBackoffSeconds: 60,
    fireToleranceMs: 60 * 1000,
  };
}

describe('runWindowRunnerLoop', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor').mockResolvedValue({
      // anchor 在 2026-06-27 05:00 local，5h 周期 → 05/10/15/20 local
      anchor: {
        startMs: new Date(2026, 5, 27, 5, 0, 0).getTime(),
        durationMs: FIVE_HOUR,
      },
      meta: {},
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('trigger=6 点本地 → fire 5 点本地 (anchor 起点)，runTask 被调用一次', async () => {
    const signal = { stopped: false };
    const config = makeConfig();
    // now 从 04:30 推进到 05:00：第一次 compute 时刻 → 选 5 点 → sleep → 醒来到点 fire
    const nowSequence = [
      new Date(2026, 5, 27, 4, 30, 0).getTime(), // round 1: compute
      new Date(2026, 5, 27, 4, 30, 0).getTime(), // sleep calc
      new Date(2026, 5, 27, 5, 0, 0).getTime(), // wake
    ];
    let nowCalls = 0;
    const runs: { taskCmd: string | undefined; ts: number }[] = [];

    await runWindowRunnerLoop({
      config,
      signal,
      now: () => nowSequence[Math.min(nowCalls++, nowSequence.length - 1)]!,
      sleep: async () => {
        // 不真睡
      },
      runTask: async (task) => {
        runs.push({ taskCmd: task.cmd, ts: Date.now() });
        signal.stopped = true; // 同步设 stop, 下一轮 while 条件立刻退出
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.taskCmd).toBe('echo hi');
    expect(resolveSpy).toHaveBeenCalled();
  });

  it('未到 fire 时间 (now < fire - tolerance) 时不执行 task', async () => {
    const signal = { stopped: false };
    const config = makeConfig();
    let sleepCalls = 0;
    const runs: number[] = [];

    await runWindowRunnerLoop({
      config,
      signal,
      // 一直返回 4:00 local，永远比 fire(5:00) 早 1h
      now: () => new Date(2026, 5, 27, 4, 0, 0).getTime(),
      sleep: async () => {
        sleepCalls++;
        // 让循环跑两轮后停掉
        if (sleepCalls >= 2) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(Date.now());
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(0);
  });

  it('provider 计算失败 → 退避后不崩，最终能恢复', async () => {
    (resolveSpy.mockReset() as jest.SpyInstance)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        anchor: { startMs: new Date(2026, 5, 27, 5, 0, 0).getTime(), durationMs: FIVE_HOUR },
        meta: {},
      });

    const signal = { stopped: false };
    const config = makeConfig();
    config.loopBackoffSeconds = 0; // 立刻可重试
    let sleepCalls = 0;
    const runs: number[] = [];

    await runWindowRunnerLoop({
      config,
      signal,
      now: () => new Date(2026, 5, 27, 5, 0, 0).getTime(), // 一直 == fire 时间
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 3) signal.stopped = true; // 兜底
      },
      runTask: async () => {
        runs.push(Date.now());
        signal.stopped = true;
        return { code: 0 };
      },
    });

    // 首轮 anchor 计算失败 → 第二轮成功并 fire
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(runs).toHaveLength(1);
  });
});
