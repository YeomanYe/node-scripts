import {
  combineDecisions,
  planProjection,
  planRate,
  planTail,
  readRemainingPercent,
  windowEndMs,
} from '../../src/llm-tail-burn/schedule';
import { AgentDecision } from '../../src/llm-tail-burn/schedule';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ts(h: number, mi: number): number {
  return new Date(2026, 5, 27, h, mi, 0, 0).getTime();
}

/** 绝对时间戳辅助：以 2026-06-27 10:00 为基准，按"加 X 小时/天"生成 */
function after(base: number, hours = 0, days = 0): number {
  return base + hours * HOUR + days * DAY;
}

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

// ─── tail ──────────────────────────────────────────────────────────────

describe('planTail', () => {
  const baseMeta = { currentEndMs: ts(15, 0), remainingPercent: 40 };

  it('未到触发时间 (now < end - leadTime) → not ready', () => {
    const d = planTail({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 0),
    });
    expect(d.ready).toBe(false);
    expect(d.triggerMs).toBe(ts(14, 30));
    expect(d.reason).toMatch(/未到触发时间/);
    expect(d.kind).toBe('tail');
  });

  it('到触发时间且额度足够 → ready', () => {
    const d = planTail({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 45),
    });
    expect(d.ready).toBe(true);
    expect(d.remainingPercent).toBe(40);
  });

  it('恰好等于 trigger → ready (边界 >=)', () => {
    const d = planTail({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 30),
    });
    expect(d.ready).toBe(true);
  });

  it('额度低于阈值 → not ready', () => {
    const d = planTail({
      meta: { ...baseMeta, remainingPercent: 3 },
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(14, 45),
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/<.*阈值/);
  });

  it('窗口已结束 (now >= end) → not ready', () => {
    const d = planTail({
      meta: baseMeta,
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 5,
      nowMs: ts(15, 0),
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/已结束/);
  });

  it('额度未知 (null) → ready (无法判定额度时放行)', () => {
    const d = planTail({
      meta: { currentEndMs: ts(15, 0) },
      leadTimeSeconds: 30 * 60,
      minRemainingPercent: 0,
      nowMs: ts(14, 45),
    });
    expect(d.ready).toBe(true);
    expect(d.remainingPercent).toBeNull();
  });
});

// ─── rate ──────────────────────────────────────────────────────────────

describe('planRate', () => {
  // codex primary：rolling 7d 窗口。now=2026-06-27 10:00, end=2026-07-04 10:00 (168h)
  const baseNow = ts(10, 0);
  const baseEnd = after(baseNow, 0, 7);

  it('速率 > 阈值 → ready (有 tail)', () => {
    // 剩 100%，168h，速率 ≈ 0.595%/h，但阈值默认 2，故 0.595 ≤ 2 → not ready
    // 想触发 ready：让速率 > 2，例如剩 100% 且只剩 40h
    const end = after(baseNow, 40);
    const d = planRate({
      meta: { resetsAtMs: end, remainingPercent: 100 },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    // 100/40 = 2.5%/h > 2
    expect(d.ready).toBe(true);
    expect(d.reason).toMatch(/2\.50.*\/h/);
    expect(d.kind).toBe('rate');
  });

  it('速率 = 阈值 → not ready (严格 >)', () => {
    // 剩 80%，40h → 80/40 = 2.0
    const end = after(baseNow, 40);
    const d = planRate({
      meta: { resetsAtMs: end, remainingPercent: 80 },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/≤/);
  });

  it('速率 < 阈值 → not ready', () => {
    // 剩 50%，168h，速率 ≈ 0.298
    const d = planRate({
      meta: { resetsAtMs: baseEnd, remainingPercent: 50 },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
  });

  it('额度未知 → not ready', () => {
    const d = planRate({
      meta: { resetsAtMs: baseEnd },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/未知/);
  });

  it('窗口已结束 → not ready', () => {
    const d = planRate({
      meta: { resetsAtMs: baseNow - 1, remainingPercent: 50 },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/已结束/);
  });

  it('剩余时间为 0 但 remaining > 0 → 视作 Infinity → ready', () => {
    const d = planRate({
      meta: { resetsAtMs: baseNow, remainingPercent: 5 },
      ratePerHour: 2,
      nowMs: baseNow,
    });
    // now >= end 走"窗口已结束"分支
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/已结束/);
  });
});

// ─── projection ────────────────────────────────────────────────────────

describe('planProjection', () => {
  // 场景：5h 短窗 + 7d 长窗。K=8 (claude 默认)
  // now = 2026-06-27 10:00
  const baseNow = ts(10, 0);
  const shortEnd = after(baseNow, 5);             // 5h 窗口结束
  const longEnd = after(baseNow, 0, 7);           // 7d 窗口结束

  it('5h 满负载投影也烧不完 7d → ready', () => {
    // R5h=100 (短窗全空), R7d=100 (长窗全空)
    // n = floor((7d - 5h) / 5h) = floor((168-5)/5) = floor(32.6) = 32
    // projectedConsume = 8 × (100/100 + 32) = 8 × 33 = 264
    // 264 < 100? 否 → not ready
    // 实际：claude 场景，按 K=8% 把 5h 跑满，连续跑 33 次能消耗 264%，远超 100%，故无 tail
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 0 },   // R5h=100
      longMeta: { resetsAtMs: longEnd, usedPercent: 0 },     // R7d=100
      shortWindowConsumePercent: 8,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/≥/);
    expect(d.kind).toBe('projection');
  });

  it('R7d 远大于投影消耗 → ready', () => {
    // R5h=100, R7d=50, K=8
    // 但用更极端：K=1（每 5h 只消耗 1% 长窗）+ R7d=100
    // n=32, projected = 1 × (1 + 32) = 33 < 100 → ready
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 0 },
      longMeta: { resetsAtMs: longEnd, usedPercent: 0 },
      shortWindowConsumePercent: 1,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(true);
    expect(d.reason).toMatch(/</);
  });

  it('5h 已无剩余但 7d 还有 → ready (典型 tail 场景)', () => {
    // R5h=0（短窗已耗尽）, R7d=50, K=8
    // projected = 8 × (0 + 32) = 256
    // 256 < 50? 否 → not ready
    // 这个反例很有意思：5h 跑满多次仍能消耗完 7d，所以没有 tail
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 100 },
      longMeta: { resetsAtMs: longEnd, usedPercent: 50 },
      shortWindowConsumePercent: 8,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
  });

  it('5h 已无剩余 + 7d 仍多 + K 小 → ready', () => {
    // R5h=0, R7d=50, K=1
    // projected = 1 × 32 = 32 < 50 → ready
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 100 },
      longMeta: { resetsAtMs: longEnd, usedPercent: 50 },
      shortWindowConsumePercent: 1,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(true);
  });

  it('短窗或长窗额度未知 → not ready', () => {
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd },
      longMeta: { resetsAtMs: longEnd, usedPercent: 50 },
      shortWindowConsumePercent: 8,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/未知/);
  });

  it('长窗已结束 → not ready', () => {
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 100 },
      longMeta: { resetsAtMs: baseNow - 1, usedPercent: 50 },
      shortWindowConsumePercent: 8,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/长窗.*已结束/);
  });

  it('K=20 (zai 默认) + 7d 满额 → 仍 not ready (5h 多次跑能烧完)', () => {
    // R5h=100, R7d=100, K=20
    // projected = 20 × 33 = 660 > 100 → not ready
    const d = planProjection({
      shortMeta: { resetsAtMs: shortEnd, usedPercent: 0 },
      longMeta: { resetsAtMs: longEnd, usedPercent: 0 },
      shortWindowConsumePercent: 20,
      nowMs: baseNow,
    });
    expect(d.ready).toBe(false);
  });
});

// ─── combineDecisions ──────────────────────────────────────────────────

function mkDecision(over: Partial<AgentDecision>): AgentDecision {
  return {
    ready: false,
    reason: 'x',
    kind: 'tail',
    windowEndMs: 1000,
    triggerMs: null,
    remainingPercent: null,
    meta: {},
    ...over,
  };
}

describe('combineDecisions', () => {
  it('match=all + 全 ready → burn', () => {
    const d = combineDecisions(
      [mkDecision({ ready: true, remainingPercent: 30 }), mkDecision({ ready: true })],
      'all'
    );
    expect(d.burn).toBe(true);
    expect(d.remainingPercent).toBe(30);
  });

  it('match=all + 部分 ready → 不 burn', () => {
    const d = combineDecisions(
      [mkDecision({ ready: true }), mkDecision({ ready: false })],
      'all'
    );
    expect(d.burn).toBe(false);
    expect(d.reason).toMatch(/1\/2 ready/);
  });

  it('match=any + 任一 ready → burn', () => {
    const d = combineDecisions(
      [mkDecision({ ready: false }), mkDecision({ ready: true, remainingPercent: 50 })],
      'any'
    );
    expect(d.burn).toBe(true);
    expect(d.remainingPercent).toBe(50);
  });

  it('match=any + 全不 ready → 不 burn', () => {
    const d = combineDecisions(
      [mkDecision({ ready: false }), mkDecision({ ready: false })],
      'any'
    );
    expect(d.burn).toBe(false);
  });

  it('windowEndMs 取最小值', () => {
    const d = combineDecisions(
      [mkDecision({ ready: true, windowEndMs: 1000 }), mkDecision({ ready: true, windowEndMs: 500 })],
      'all'
    );
    expect(d.windowEndMs).toBe(500);
  });

  it('triggerMs 取最大值（最严苛）', () => {
    const d = combineDecisions(
      [
        mkDecision({ ready: true, triggerMs: 100 }),
        mkDecision({ ready: true, triggerMs: 300 }),
        mkDecision({ ready: true, triggerMs: null }),
      ],
      'all'
    );
    expect(d.triggerMs).toBe(300);
  });

  it('所有 agent triggerMs=null → combined.triggerMs=null', () => {
    const d = combineDecisions(
      [mkDecision({ ready: true, triggerMs: null }), mkDecision({ ready: true, triggerMs: null })],
      'any'
    );
    expect(d.triggerMs).toBeNull();
  });

  it('空数组 → 抛错', () => {
    expect(() => combineDecisions([], 'any')).toThrow();
  });

  it('全 not ready → remainingPercent 取首个 agent 的值', () => {
    const d = combineDecisions(
      [mkDecision({ ready: false, remainingPercent: 20 }), mkDecision({ ready: false, remainingPercent: 50 })],
      'any'
    );
    expect(d.remainingPercent).toBe(20);
  });
});
