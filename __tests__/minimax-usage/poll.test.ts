import { buildPollReport } from '../../src/minimax-usage/poll';
import type { MiniMaxQuotaSnapshot } from '../../src/minimax-usage/types';

const NOW = 1_700_000_000_000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;
// 窗口还剩 1h 重置 → 已过 4h → 线性预算 80%
const END = NOW + 1 * 60 * 60 * 1000;
const START = END - FIVE_HOURS;

function makeSnapshot(remainingPercent: number): MiniMaxQuotaSnapshot {
  return {
    planName: 'Plus',
    raw: {},
    models: [
      {
        modelName: 'general',
        interval: {
          startMs: START,
          endMs: END,
          remainsMs: FIVE_HOURS,
          totalCount: 100,
          usageCount: 0,
          remainingPercent,
          usedPercent: 100 - remainingPercent,
          status: 1,
        },
        weekly: {
          startMs: START,
          endMs: END,
          remainsMs: FIVE_HOURS,
          totalCount: 100,
          usageCount: 0,
          remainingPercent: 100,
          usedPercent: 0,
          status: 3,
        },
      },
    ],
  };
}

describe('minimax-usage poll report', () => {
  test('info when below linear budget', () => {
    // remaining 50 → used 50% < 线性 80%
    const report = buildPollReport(makeSnapshot(50), { windows: ['interval'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.content).toMatch(/线性预算 80\.0%/);
  });

  test('warn when above linear budget', () => {
    // remaining 5 → used 95% > 线性 80%
    const report = buildPollReport(makeSnapshot(5), { windows: ['interval'], nowMs: NOW });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('告警');
    expect(report.summaryLine).toContain('alert=true');
  });
});
