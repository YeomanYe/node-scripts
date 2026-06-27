import {
  enumerateStarts,
  findNearestStart,
  nextConfiguredTrigger,
  WindowAnchor,
} from '../../src/llm-window-runner/schedule';

const HOUR = 60 * 60 * 1000;
const FIVE_HOUR = 5 * HOUR;

describe('enumerateStarts', () => {
  const anchor: WindowAnchor = { startMs: 100, durationMs: 10 };

  it('在区间内枚举所有 anchor + k*duration 点', () => {
    expect(enumerateStarts(anchor, 95, 135)).toEqual([100, 110, 120, 130]);
  });

  it('可以往前枚举到负 k', () => {
    expect(enumerateStarts(anchor, 70, 105)).toEqual([70, 80, 90, 100]);
  });

  it('from > to 时返回空', () => {
    expect(enumerateStarts(anchor, 200, 100)).toEqual([]);
  });

  it('duration <= 0 时抛错', () => {
    expect(() => enumerateStarts({ startMs: 0, durationMs: 0 }, 0, 10)).toThrow(/durationMs/);
  });

  it('NaN startMs 抛错', () => {
    expect(() => enumerateStarts({ startMs: NaN, durationMs: 10 }, 0, 10)).toThrow();
  });
});

describe('nextConfiguredTrigger', () => {
  it('今天还没到 HH:MM → 返回今天', () => {
    const now = new Date(2026, 5, 27, 4, 30); // 6 月 27 日 04:30 本地时间
    const next = nextConfiguredTrigger('06:00', now);
    expect(next.getDate()).toBe(27);
    expect(next.getHours()).toBe(6);
    expect(next.getMinutes()).toBe(0);
  });

  it('今天 HH:MM 已过 → 返回明天', () => {
    const now = new Date(2026, 5, 27, 8, 0);
    const next = nextConfiguredTrigger('06:00', now);
    expect(next.getDate()).toBe(28);
    expect(next.getHours()).toBe(6);
  });

  it('HH:MM 恰好等于 now → 返回明天 (用 <=)', () => {
    const now = new Date(2026, 5, 27, 6, 0, 0, 0);
    const next = nextConfiguredTrigger('06:00', now);
    expect(next.getDate()).toBe(28);
  });

  it('格式错误抛错', () => {
    expect(() => nextConfiguredTrigger('25:00', new Date())).toThrow(/小时/);
    expect(() => nextConfiguredTrigger('6-00', new Date())).toThrow(/HH:MM/);
    expect(() => nextConfiguredTrigger('12:60', new Date())).toThrow(/分钟/);
  });
});

describe('findNearestStart', () => {
  // minimax interval-like: anchor 10:00, 5h 周期 → 起点 10/15/20...
  const anchor: WindowAnchor = { startMs: ts(2026, 0, 1, 10, 0), durationMs: FIVE_HOUR };

  it('用户示例：target=6 点，候选 5/10 → 选 5', () => {
    // 此处用 anchor 10:00 + 5h 周期。今天 6 点 target，候选 5/10/15/...
    const target = ts(2026, 0, 1, 6, 0);
    const now = ts(2026, 0, 1, 0, 0);
    const r = findNearestStart(anchor, target, now);
    expect(r.fireAtMs).toBe(ts(2026, 0, 1, 5, 0));
    expect(r.fallback).toBe(false);
  });

  it('target 之后的最近候选距离更小 → 选之后', () => {
    // target=9:00。候选 5/10/15。5 距 4h，10 距 1h → 选 10
    const target = ts(2026, 0, 1, 9, 0);
    const now = ts(2026, 0, 1, 0, 0);
    const r = findNearestStart(anchor, target, now);
    expect(r.fireAtMs).toBe(ts(2026, 0, 1, 10, 0));
  });

  it('并列 → 取更早', () => {
    // target=12:30。候选 5/10/15/20。10 和 15 都距 2.5h。取 10
    const target = ts(2026, 0, 1, 12, 30);
    const now = ts(2026, 0, 1, 0, 0);
    const r = findNearestStart(anchor, target, now);
    expect(r.fireAtMs).toBe(ts(2026, 0, 1, 10, 0));
  });

  it('候选全部在 now 之前 → fallback 到 target', () => {
    // 极端：duration=1h，target 在 now 之前
    const a: WindowAnchor = { startMs: 0, durationMs: HOUR };
    const target = ts(2026, 0, 1, 6, 0);
    const now = ts(2026, 0, 1, 7, 0); // now 已晚于 target
    const r = findNearestStart(a, target, now);
    // 候选会包含 7:00, 8:00, ... 这些都 >= now，所以不会 fallback；7:00 离 target 最近
    expect(r.fallback).toBe(false);
    expect(r.fireAtMs).toBe(ts(2026, 0, 1, 7, 0));
  });

  it('horizon 之外没有候选 + target 也在过去 → fallback', () => {
    // duration 巨大，远远超出 horizon，且 anchor.start 远在未来
    const a: WindowAnchor = { startMs: ts(3000, 0, 1, 0, 0), durationMs: 365 * 24 * HOUR };
    const target = ts(2026, 0, 1, 6, 0);
    const now = ts(2026, 0, 1, 5, 0);
    const r = findNearestStart(a, target, now, HOUR);
    expect(r.fallback).toBe(true);
    expect(r.fireAtMs).toBe(target); // target 还在 now 之后
  });
});

function ts(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo, d, h, mi, 0, 0).getTime();
}
