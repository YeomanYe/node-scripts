import { BurnAgent, BurnRunnerConfig, BurnTask } from '../../src/llm-tail-burn/config';
import { runBurnLoop } from '../../src/llm-tail-burn/loop';
import * as windowsMod from '../../src/llm-window-runner/windows';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ts(h: number, mi: number): number {
  return new Date(2026, 5, 27, h, mi, 0, 0).getTime();
}

function after(base: number, hours = 0, days = 0): number {
  return base + hours * HOUR + days * DAY;
}

function makeTask(agents: BurnAgent[], overrides?: Partial<BurnTask>): BurnTask {
  return {
    agents,
    match: 'any',
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
  };
}

function makeConfig(task: BurnTask): BurnRunnerConfig {
  return {
    providers: {
      mm: { type: 'minimax', window: 'interval' },
      codex: { type: 'codex', window: 'primary' },
      claude5h: { type: 'claude', window: 'fiveHour' },
      claude7d: { type: 'claude', window: 'sevenDay' },
    },
    tasks: { burn: task },
    loopMaxSleepSeconds: 600,
    loopMinCooldownSeconds: 0,
    loopBackoffSeconds: 60,
  };
}

const tailAgent: BurnAgent = {
  kind: 'tail',
  provider: 'mm',
  leadTimeSeconds: 30 * 60,
  minRemainingPercent: 5,
};

const rateAgent: BurnAgent = {
  kind: 'rate',
  provider: 'codex',
  ratePerHour: 2,
};

const projectionAgent: BurnAgent = {
  kind: 'projection',
  provider: 'claude5h',
  pairedProvider: 'claude7d',
  shortWindowConsumePercent: 8,
};

describe('runBurnLoop (tail agent)', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('未到触发时间 → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(makeTask([tailAgent]));
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
    const config = makeConfig(makeTask([tailAgent], { cooldownSeconds: 1 }));
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
    const config = makeConfig(makeTask([tailAgent], { maxIterations: 2, cooldownSeconds: 1 }));
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
    const config = makeConfig(makeTask([tailAgent], { stopOnError: true, cooldownSeconds: 1 }));
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
    const config = makeConfig(makeTask([tailAgent], { maxIterations: 1, cooldownSeconds: 1 }));
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
    const config = makeConfig(makeTask([tailAgent]));
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

describe('runBurnLoop (rate agent)', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('速率 > 阈值 → fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(makeTask([rateAgent], { cooldownSeconds: 1 }));
    // now=10:00, end=+40h, remaining=100% → 100/40 = 2.5%/h > 2
    const baseNow = ts(10, 0);
    resolveSpy.mockResolvedValue({
      anchor: { startMs: baseNow, durationMs: 40 * HOUR },
      meta: { resetsAtMs: after(baseNow, 40), remainingPercent: 100 },
    });

    let sleepCalls = 0;
    const runs: number[] = [];
    let taskFired = false;

    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 2) signal.stopped = true;
      },
      runTask: async () => {
        runs.push(1);
        taskFired = true;
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(taskFired).toBe(true);
  });

  it('速率 ≤ 阈值 → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(makeTask([rateAgent]));
    // now=10:00, end=+168h (7d), remaining=50% → 50/168 ≈ 0.30
    const baseNow = ts(10, 0);
    resolveSpy.mockResolvedValue({
      anchor: { startMs: baseNow, durationMs: 7 * DAY },
      meta: { resetsAtMs: after(baseNow, 0, 7), remainingPercent: 50 },
    });

    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
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
});

describe('runBurnLoop (projection agent)', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('投影消耗 < 长窗剩余 → fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(makeTask([projectionAgent], { cooldownSeconds: 1 }));
    const baseNow = ts(10, 0);
    const shortEnd = after(baseNow, 5);
    const longEnd = after(baseNow, 0, 7);

    // K=8, R5h=0, R7d=50: projected = 8 × (0 + 32) = 256 ≥ 50 → not ready
    // 改用 K=1 让投影 < R7d
    const config2 = makeConfig(
      makeTask([
        { kind: 'projection', provider: 'claude5h', pairedProvider: 'claude7d', shortWindowConsumePercent: 1 },
      ])
    );
    resolveSpy.mockImplementation(async (provider: { window: string }) => {
      if (provider.window === 'fiveHour') {
        return { anchor: { startMs: baseNow, durationMs: 5 * HOUR }, meta: { resetsAtMs: shortEnd, usedPercent: 100 } };
      }
      return { anchor: { startMs: baseNow, durationMs: 7 * DAY }, meta: { resetsAtMs: longEnd, usedPercent: 50 } };
    });

    let sleepCalls = 0;
    let fired = false;

    await runBurnLoop({
      config: config2,
      signal,
      now: () => baseNow,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls >= 2) signal.stopped = true;
      },
      runTask: async () => {
        fired = true;
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(fired).toBe(true);
  });

  it('投影消耗 ≥ 长窗剩余 → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(makeTask([projectionAgent]));
    const baseNow = ts(10, 0);
    const shortEnd = after(baseNow, 5);
    const longEnd = after(baseNow, 0, 7);

    resolveSpy.mockImplementation(async (provider: { window: string }) => {
      if (provider.window === 'fiveHour') {
        return { anchor: { startMs: baseNow, durationMs: 5 * HOUR }, meta: { resetsAtMs: shortEnd, usedPercent: 100 } };
      }
      return { anchor: { startMs: baseNow, durationMs: 7 * DAY }, meta: { resetsAtMs: longEnd, usedPercent: 50 } };
    });

    let sleepCalls = 0;
    const runs: number[] = [];

    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
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
});

describe('runBurnLoop (multi-agent all/any)', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(windowsMod, 'resolveWindowAnchor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('match=all + 全部 ready → fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(
      makeTask([tailAgent, rateAgent], { match: 'all', cooldownSeconds: 1 })
    );
    const baseNow = ts(14, 45);
    resolveSpy.mockImplementation(async (provider: { type: string }) => {
      if (provider.type === 'minimax') {
        return { anchor: {}, meta: { currentEndMs: ts(15, 0), remainingPercent: 40 } };
      }
      // codex rate: 100/40 = 2.5 > 2 → ready
      return { anchor: {}, meta: { resetsAtMs: after(baseNow, 40), remainingPercent: 100 } };
    });

    let fired = false;
    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
      sleep: async () => {
        signal.stopped = true;
      },
      runTask: async () => {
        fired = true;
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(fired).toBe(true);
  });

  it('match=all + 部分 ready → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(
      makeTask([tailAgent, rateAgent], { match: 'all' })
    );
    const baseNow = ts(14, 45);
    resolveSpy.mockImplementation(async (provider: { type: string }) => {
      if (provider.type === 'minimax') {
        // minimax ready
        return { anchor: {}, meta: { currentEndMs: ts(15, 0), remainingPercent: 40 } };
      }
      // codex not ready: 50/168 ≈ 0.30 ≤ 2
      return { anchor: {}, meta: { resetsAtMs: after(baseNow, 0, 7), remainingPercent: 50 } };
    });

    let sleepCalls = 0;
    const runs: number[] = [];
    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
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

  it('match=any + 任一 ready → fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(
      makeTask([tailAgent, rateAgent], { match: 'any', cooldownSeconds: 1 })
    );
    const baseNow = ts(14, 45);
    resolveSpy.mockImplementation(async (provider: { type: string }) => {
      if (provider.type === 'minimax') {
        // not ready: 剩 3%
        return { anchor: {}, meta: { currentEndMs: ts(15, 0), remainingPercent: 3 } };
      }
      // codex ready
      return { anchor: {}, meta: { resetsAtMs: after(baseNow, 40), remainingPercent: 100 } };
    });

    let fired = false;
    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
      sleep: async () => {
        signal.stopped = true;
      },
      runTask: async () => {
        fired = true;
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(fired).toBe(true);
  });

  it('match=any + 全不 ready → 不 fire', async () => {
    const signal = { stopped: false };
    const config = makeConfig(
      makeTask([tailAgent, rateAgent], { match: 'any' })
    );
    const baseNow = ts(14, 0);  // 未到 tail 触发时间
    resolveSpy.mockImplementation(async (provider: { type: string }) => {
      if (provider.type === 'minimax') {
        return { anchor: {}, meta: { currentEndMs: ts(15, 0), remainingPercent: 40 } };
      }
      return { anchor: {}, meta: { resetsAtMs: after(baseNow, 0, 7), remainingPercent: 50 } };
    });

    let sleepCalls = 0;
    const runs: number[] = [];
    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
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

  it('match=all + 任一 agent snapshot 失败 → 退避，恢复后继续', async () => {
    const signal = { stopped: false };
    const config = makeConfig(
      makeTask([tailAgent, rateAgent], { match: 'all', cooldownSeconds: 1 })
    );
    config.loopBackoffSeconds = 0;
    const baseNow = ts(14, 45);

    let resolveCount = 0;
    resolveSpy.mockImplementation(async (provider: { type: string }) => {
      resolveCount++;
      if (provider.type === 'minimax') {
        return { anchor: {}, meta: { currentEndMs: ts(15, 0), remainingPercent: 40 } };
      }
      // codex 第一次抛错，第二次成功
      if (resolveCount === 2) {
        throw new Error('codex boom');
      }
      return { anchor: {}, meta: { resetsAtMs: after(baseNow, 40), remainingPercent: 100 } };
    });

    let fired = false;
    await runBurnLoop({
      config,
      signal,
      now: () => baseNow,
      sleep: async () => {
        // 多睡几次让 retry 跑完
      },
      runTask: async () => {
        fired = true;
        signal.stopped = true;
        return { code: 0 };
      },
    });

    expect(fired).toBe(true);
  });
});
