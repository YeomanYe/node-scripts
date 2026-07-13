import { BurnRunnerConfig, BurnTask } from '../../src/llm-tail-burn/config';
import { runBurnLoop } from '../../src/llm-tail-burn/loop';
import * as windowsMod from '../../src/llm-window-runner/windows';

const HOUR = 60 * 60 * 1000;

function ts(h: number, mi: number): number {
  return new Date(2026, 5, 27, h, mi, 0, 0).getTime();
}

function makeConfig(overrides?: Partial<BurnTask>): BurnRunnerConfig {
  return {
    providers: {
      mm: { type: 'minimax', window: 'interval' },
    },
    tasks: {
      burn: {
        provider: 'mm',
        leadTimeSeconds: 30 * 60,
        minRemainingPercent: 5,
        maxIterations: 0,
        cooldownSeconds: 60,
        stopOnError: false,
        cmd: 'echo burn',
        command: undefined,
        args: [],
        cwd: undefined,
        env: {},
        shell: true,
        ...overrides,
      },
    },
    loopMaxSleepSeconds: 600,
    loopMinCooldownSeconds: 0,
    loopBackoffSeconds: 60,
  };
}

describe('runBurnLoop', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('未到触发时间 → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig();
    resolveSpy.mockResolvedValue({
      anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
      meta: { currentEndMs: ts(15, 0), remainingPercent: 40 },
    });
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => ts(14, 0),
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 2) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(0);
  });

  it('到点 burn → 额度耗尽后停止', async () => {
    const signal = { stopped: false };
    const config = makeConfig({ cooldownSeconds: 1 });
    let remain = 40;
    resolveSpy.mockImplementation(async () => ({
      anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
      meta: { currentEndMs: ts(15, 0), remainingPercent: remain },
    }));

    let nowIdx = 0;
    const nowSeq = [ts(14, 0), ts(14, 45), ts(14, 46)];
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => nowSeq[Math.min(nowIdx++, nowSeq.length - 1)]!,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 3) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        remain = 3;
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(1);
    expect(resolveSpy).toHaveBeenCalled();
  });

  it('maxIterations 限制：burn 达上限后停止本窗口', async () => {
    const signal = { stopped: false };
    const config = makeConfig({ maxIterations: 2, cooldownSeconds: 1 });
    resolveSpy.mockResolvedValue({
      anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
      meta: { currentEndMs: ts(15, 0), remainingPercent: 40 },
    });

    let nowIdx = 0;
    const nowSeq = [ts(14, 45), ts(14, 46), ts(14, 47), ts(14, 48), ts(14, 49)];
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => nowSeq[Math.min(nowIdx++, nowSeq.length - 1)]!,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 5) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(2);
  });

  it('stopOnError: 脚本失败后停止本窗口', async () => {
    const signal = { stopped: false };
    const config = makeConfig({ stopOnError: true, cooldownSeconds: 1 });
    resolveSpy.mockResolvedValue({
      anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
      meta: { currentEndMs: ts(15, 0), remainingPercent: 40 },
    });

    let nowIdx = 0;
    const nowSeq = [ts(14, 45), ts(14, 46), ts(14, 47)];
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => nowSeq[Math.min(nowIdx++, nowSeq.length - 1)]!,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 3) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        return { code: 1 };
      },
    });

    expect(runs).toHaveLength(1);
  });

  it('窗口切换后重置 burnCount 继续 burn', async () => {
    const signal = { stopped: false };
    const config = makeConfig({ maxIterations: 1, cooldownSeconds: 1 });
    let callCount = 0;
    resolveSpy.mockImplementation(async () => {
      callCount++;
      const endMs = callCount <= 2 ? ts(15, 0) : ts(20, 0);
      return {
        anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
        meta: { currentEndMs: endMs, remainingPercent: 40 },
      };
    });

    let nowIdx = 0;
    const nowSeq = [ts(14, 45), ts(14, 46), ts(19, 45), ts(19, 46), ts(19, 47)];
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => nowSeq[Math.min(nowIdx++, nowSeq.length - 1)]!,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 5) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        return { code: 0 };
      },
    });

    expect(runs).toHaveLength(2);
  });

  it('provider 拉取失败 → 退避不崩，恢复后 fire', async () => {
    (resolveSpy.mockReset() as jest.SpyInstance)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        anchor: { startMs: ts(10, 0), durationMs: 5 * HOUR },
        meta: { currentEndMs: ts(15, 0), remainingPercent: 40 },
      });

    const signal = { stopped: false };
    const config = makeConfig();
    config.loopBackoffSeconds = 0;
    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => ts(14, 45),
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 3) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(runs).toHaveLength(1);
  });
});
