import { buildPollReport } from '../../src/codex-usage/poll';
import type { UsageSnapshot } from '../../src/codex-usage/types';

const nowSec = 1_700_000_000;
const nowMs = nowSec * 1000;

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    planType: 'pro',
    primary: { usedPercent: 20, windowMinutes: 300, resetsAt: nowSec + 150 * 60 },
    secondary: { usedPercent: 30, windowMinutes: 10080, resetsAt: nowSec + 5040 * 60 },
    additional: [],
    raw: {},
    ...overrides,
  };
}

describe('codex-usage buildPollReport', () => {
  test('info level when all windows under linear budget', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 40, windowMinutes: 300, resetsAt: nowSec + 150 * 60 },
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
    expect(report.title).toContain('用量');
  });

  test('warn level when breach', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 80, windowMinutes: 300, resetsAt: nowSec + 150 * 60 },
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('warn');
    expect(report.alerts.map((a) => a.window)).toEqual(['primary']);
  });

  test('skips window with null windowMinutes', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 99, windowMinutes: null, resetsAt: nowSec + 60 },
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
    expect(report.content).toContain('windowMinutes 未知');
  });

  test('skips missing window silently', () => {
    const snap = makeSnapshot({ primary: undefined });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
  });
});
