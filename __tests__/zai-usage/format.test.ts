import { formatLocalTime, formatWindowLine, formatUsageText } from '@/zai-usage/format';
import type { ZaiLimitWindow, ZaiUsageSnapshot } from '@/zai-usage/types';

const primary: ZaiLimitWindow = {
  type: 'TOKENS_LIMIT', windowMinutes: 300, windowLabel: '5 hours window',
  usage: 100, remaining: 80, currentValue: 20, usedPercent: 20, resetsAtMs: 1_700_000_000_000,
  usageDetails: [],
};

describe('zai-usage format', () => {
  test('formatLocalTime handles null', () => {
    expect(formatLocalTime(null)).toBe('未知');
    expect(formatLocalTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('formatWindowLine renders label / 用量 / 线性预算 / 重置', () => {
    const line = formatWindowLine(primary, '主窗口');
    expect(line).toContain('主窗口');
    expect(line).toContain('20%');
  });

  test('formatUsageText with empty snapshot', () => {
    const snapshot: ZaiUsageSnapshot = { planName: null, primary: null, secondary: null, raw: {} };
    const text = formatUsageText(snapshot, 1_700_000_000_000);
    expect(text).toContain('未返回用量数据');
  });
});
