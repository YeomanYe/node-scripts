import { evaluateMiniMaxGate } from '../../src/minimax-gated-run/gate';
import { MiniMaxQuotaSnapshot } from '../../src/minimax-usage/types';

function makeSnapshot(usedPercent: number): MiniMaxQuotaSnapshot {
  return {
    raw: {},
    models: [
      {
        modelName: 'general',
        interval: {
          startMs: 1_000,
          endMs: 1_000 + 5 * 60 * 60 * 1000,
          remainsMs: 2 * 60 * 60 * 1000,
          totalCount: 100,
          usageCount: usedPercent,
          remainingPercent: 100 - usedPercent,
          usedPercent,
          status: 1,
        },
        weekly: {
          startMs: 1_000,
          endMs: 1_000 + 7 * 24 * 60 * 60 * 1000,
          remainsMs: 1,
          totalCount: 100,
          usageCount: usedPercent,
          remainingPercent: 100 - usedPercent,
          usedPercent,
          status: 1,
        },
      },
    ],
  };
}

describe('minimax-gated-run gate', () => {
  const nowMs = 1_000 + 3 * 60 * 60 * 1000;

  test('skips when usage equals the linear budget', () => {
    const decision = evaluateMiniMaxGate({
      snapshot: makeSnapshot(60),
      model: 'general',
      window: 'interval',
      minHeadroomPercent: 0,
      allowOnUnknownQuota: false,
      nowMs,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.usedPercent).toBe(60);
    expect(decision.expectedPercent).toBe(60);
  });

  test('allows when usage is below the linear budget', () => {
    const decision = evaluateMiniMaxGate({
      snapshot: makeSnapshot(59.9),
      model: 'general',
      window: 'interval',
      minHeadroomPercent: 0,
      allowOnUnknownQuota: false,
      nowMs,
    });

    expect(decision.allowed).toBe(true);
  });

  test('skips unknown quota by default', () => {
    const decision = evaluateMiniMaxGate({
      snapshot: { raw: {}, models: [] },
      model: 'general',
      window: 'interval',
      minHeadroomPercent: 0,
      allowOnUnknownQuota: false,
      nowMs,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('跳过');
  });
});
