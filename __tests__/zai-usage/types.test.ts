import 'jest';
import type {
  ZaiLimitType,
  ZaiLimitWindow,
  ZaiUsageSnapshot,
  ZaiRawQuotaResponse,
} from '@/zai-usage/types';

describe('zai-usage types', () => {
  test('limit type union is narrow', () => {
    const a: ZaiLimitType = 'TOKENS_LIMIT';
    const b: ZaiLimitType = 'TIME_LIMIT';
    expect([a, b]).toEqual(['TOKENS_LIMIT', 'TIME_LIMIT']);
  });

  test('window shape compiles', () => {
    const w: ZaiLimitWindow = {
      type: 'TOKENS_LIMIT',
      windowMinutes: 300,
      windowLabel: '5 hour window',
      usage: 100,
      remaining: 80,
      currentValue: 20,
      usedPercent: 20,
      resetsAtMs: 123,
      usageDetails: [{ modelCode: 'glm-4.6', usage: 10 }],
    };
    expect(w.usedPercent).toBe(20);
  });

  test('snapshot shape compiles', () => {
    const s: ZaiUsageSnapshot = {
      planName: 'Pro',
      primary: null,
      secondary: null,
      raw: {} as ZaiRawQuotaResponse,
    };
    expect(s.planName).toBe('Pro');
  });
});
