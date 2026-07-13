import {
  planBurn,
  readRemainingPercent,
  windowEndMs,
} from '../../src/llm-tail-burn/schedule';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('windowEndMs', () => {
  it('minimax: 取 currentEndMs', () => {
    expect(windowEndMs({ currentEndMs: 1000 })).toBe(1000);
  });

  it('zai/claude/codex: 取 resetsAtMs', () => {
    expect(windowEndMs({ resetsAtMs: 2000 })).toBe(2000);
  });

  it('两者都没有 → 抛错', () => {
    expect(() => windowEndMs({})).toThrow(/currentEndMs.*resetsAtMs/);
    expect(() => windowEndMs({ currentEndMs: 'x' })).toThrow();
  });

  it('currentEndMs 优先于 resetsAtMs', () => {
    expect(windowEndMs({ currentEndMs: 1000, resetsAtMs: 2000 })).toBe(1000);
  });
});

describe('readRemainingPercent', () => {
  it('minimax: remainingPercent 直取', () => {
    expect(readRemainingPercent({ remainingPercent: 30 })).toBe(30);
  });

  it('zai/codex: 100 - usedPercent', () => {
    expect(readRemainingPercent({ usedPercent: 40 })).toBe(60);
  });

  it('claude: 100 - utilization', () => {
    expect(readRemainingPercent({ utilization: 25 })).toBe(75);
  });

  it('remainingPercent 优先于 usedPercent', () => {
    expect(readRemainingPercent({ remainingPercent: 10, usedPercent: 40 })).toBe(10);
  });

  it('未知字段 → null', () => {
    expect(readRemainingPercent({})).toBeNull();
  });
});

describe('planBurn', () => {
  // minimax 5h 窗口：start=10:00, end=15:00, remaining=40%
  const baseMeta = { currentEndMs: ts(15, 0), remainingPercent: 40 };

  it('未到触发时间 (now < end - leadTime) → 不 burn', () => {
    const d = planBurn({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60, // 30min → trigger = 14:30
      minRemainingPercent: 5,
      nowMs: ts(14, 0),
    });
    expect(d.burn).toBe(false);
    expect(d.triggerMs).toBe(ts(14, 30));
    expect(d.reason).toMatch(/未到触发时间/);
  });

  it('到触发时间且额度足够 → burn', () => {
    const d = planBurn({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 45), // 在 [14:30, 15:00) 内
    });
    expect(d.burn).toBe(true);
    expect(d.remainingPercent).toBe(40);
  });

  it('恰好等于 trigger → burn (边界 >=)', () => {
    const d = planBurn({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 30),
    });
    expect(d.burn).toBe(true);
  });

  it('额度低于阈值 → 不 burn', () => {
    const d = planBurn({
      meta: { ...baseMeta, remainingPercent: 3 },
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 45),
    });
    expect(d.burn).toBe(false);
    expect(d.reason).toMatch(/额度.*<.*阈值/);
  });

  it('窗口已结束 (now >= end) → 不 burn', () => {
    const d = planBurn({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(15, 0), // == end
    });
    expect(d.burn).toBe(false);
    expect(d.reason).toMatch(/已结束/);
  });

  it('额度未知 (null) + minRemainingPercent=0 → burn', () => {
    const d = planBurn({
      meta: { currentEndMs: ts(15, 0) },
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 0,
      nowMs: ts(14, 45),
    });
    expect(d.burn).toBe(true);
    expect(d.remainingPercent).toBeNull();
  });

  it('额度未知 (null) + minRemainingPercent>0 → burn (无法判定额度时放行)', () => {
    const d = planBurn({
      meta: { currentEndMs: ts(15, 0) },
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 50,
      nowMs: ts(14, 45),
    });
    expect(d.burn).toBe(true);
  });
});

function ts(h: number, mi: number): number {
  return new Date(2026, 5, 27, h, mi, 0, 0).getTime();
}
