import { buildPollReport } from '../../src/claude-usage/poll';
import type { UsageData } from '../../src/claude-usage/types';

const now = 1_700_000_000_000;
const FIVE_H = 5 * 3600 * 1000;
const SEVEN_D = 7 * 24 * 3600 * 1000;

function makeUsage(overrides: Partial<UsageData> = {}): UsageData {
  return {
    fiveHour: { utilization: 20, resetsAt: new Date(now + FIVE_H / 2).toISOString() },
    sevenDay: { utilization: 30, resetsAt: new Date(now + SEVEN_D / 2).toISOString() },
    sevenDaySonnet: null,
    sevenDayOpus: null,
    sevenDayCowork: null,
    extraUsage: null,
    ...overrides,
  };
}

describe('claude-usage buildPollReport', () => {
  test('info level when all windows under linear budget', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 40, resetsAt: new Date(now + FIVE_H / 2).toISOString() },
      sevenDay: { utilization: 40, resetsAt: new Date(now + SEVEN_D / 2).toISOString() },
    });
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
    expect(report.title).toContain('用量');
    expect(report.content).toContain('5 小时');
    expect(report.alerts).toHaveLength(0);
  });

  test('warn level when any configured window breached', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 80, resetsAt: new Date(now + FIVE_H / 2).toISOString() },
      sevenDay: { utilization: 20, resetsAt: new Date(now + SEVEN_D / 2).toISOString() },
    });
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('告警');
    expect(report.alerts.map((a) => a.window)).toEqual(['five_hour']);
  });

  test('skips windows not in configured list', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 90, resetsAt: new Date(now + FIVE_H / 2).toISOString() },
    });
    const report = buildPollReport(usage, {
      windows: ['seven_day'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
  });

  test('skips null optional windows (sonnet/opus) silently', () => {
    const usage = makeUsage();
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
  });
});
