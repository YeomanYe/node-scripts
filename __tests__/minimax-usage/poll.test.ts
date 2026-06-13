import { buildPollReport } from '../../src/minimax-usage/poll';
import type { MiniMaxQuotaSnapshot } from '../../src/minimax-usage/types';

function makeSnapshot(intervalRemaining = 97): MiniMaxQuotaSnapshot {
  return {
    raw: {},
    models: [
      {
        modelName: 'general',
        interval: {
          startMs: 1,
          endMs: 2,
          remainsMs: 1,
          totalCount: 10,
          usageCount: 1,
          remainingPercent: intervalRemaining,
          usedPercent: 100 - intervalRemaining,
          status: 1,
        },
        weekly: {
          startMs: 1,
          endMs: 2,
          remainsMs: 1,
          totalCount: 100,
          usageCount: 5,
          remainingPercent: 100,
          usedPercent: 0,
          status: 3,
        },
      },
    ],
  };
}

describe('minimax-usage poll report', () => {
  test('builds info report for healthy quota', () => {
    const report = buildPollReport(makeSnapshot(97), 1_700_000_000_000);
    expect(report.level).toBe('info');
    expect(report.title).toContain('MiniMax 用量报告');
    expect(report.content).toContain('general');
  });

  test('warns when remaining percent is low', () => {
    const report = buildPollReport(makeSnapshot(20), 1_700_000_000_000);
    expect(report.level).toBe('warn');
    expect(report.title).toContain('告警');
  });
});
