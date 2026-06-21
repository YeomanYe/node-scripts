import { buildPollReport } from '@/zai-usage/poll';
import type { ZaiUsageSnapshot, ZaiLimitWindow } from '@/zai-usage/types';

function makeWindow(over: { usedPercent: number; resetsAtMs: number; windowMinutes: number | null }): ZaiLimitWindow {
  return {
    type: 'TOKENS_LIMIT',
    windowMinutes: over.windowMinutes,
    windowLabel: '5 hours window',
    usage: 100, remaining: null, currentValue: null,
    usedPercent: over.usedPercent,
    resetsAtMs: over.resetsAtMs,
    usageDetails: [],
  };
}

// 固定 now，窗口 5 小时(=18_000_000ms)。窗口在 now 之后 1 小时重置 → 已过 4 小时 → 线性预算 80%。
const NOW = 1_700_000_000_000;
const WINDOW_MS = 5 * 60 * 60 * 1000;
const RESETS_AT = NOW + 1 * 60 * 60 * 1000; // 还有 1h 重置 → elapsed 4h → expected 80%

function makeSnapshot(usedPercent: number): ZaiUsageSnapshot {
  return {
    planName: 'Pro',
    primary: makeWindow({ usedPercent, resetsAtMs: RESETS_AT, windowMinutes: 300 }),
    secondary: null,
    raw: {},
  };
}

describe('zai-usage poll report', () => {
  test('info when 用量低于线性预算', () => {
    // 用量 50% < 线性 80% → 不告警
    const report = buildPollReport(makeSnapshot(50), { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.title).toContain('Z.ai 用量报告');
    expect(report.content).toContain('线性预算');
    expect(report.summaryLine).toContain('alert=false');
  });

  test('warn when 用量超过线性预算', () => {
    // 用量 90% > 线性 80% → 告警
    const report = buildPollReport(makeSnapshot(90), { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('Z.ai 用量告警');
    expect(report.content).toContain('🚨');
    expect(report.summaryLine).toContain('alert=true');
  });

  test('skips window with unknown windowMinutes', () => {
    const snapshot: ZaiUsageSnapshot = {
      planName: null,
      primary: makeWindow({ usedPercent: 90, resetsAtMs: RESETS_AT, windowMinutes: null }),
      secondary: null,
      raw: {},
    };
    const report = buildPollReport(snapshot, { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.content).toContain('跳过告警判定');
  });

  test('expected uses checkProrated math (80%)', () => {
    const report = buildPollReport(makeSnapshot(50), { windows: ['primary'], nowMs: NOW });
    // 解析 content 里的 "线性预算 80%"
    expect(report.content).toMatch(/线性预算 80\.0%/);
  });
});
