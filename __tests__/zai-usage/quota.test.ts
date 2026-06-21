import { normalizeZaiUsage, parseZaiLimitUnit } from '@/zai-usage/quota';

describe('zai-usage quota normalize', () => {
  test('parses usage response — primary=TOKENS, secondary=TIME', () => {
    const snapshot = normalizeZaiUsage({
      code: 200,
      msg: 'Operation successful',
      success: true,
      data: {
        limits: [
          {
            type: 'TIME_LIMIT', unit: 5, number: 1, usage: 100,
            currentValue: 102, remaining: 0, percentage: 100,
            usageDetails: [{ modelCode: 'search-prime', usage: 95 }],
          },
          {
            type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 40000000,
            currentValue: 13628365, remaining: 26371635, percentage: 34,
            nextResetTime: 1768507567547,
          },
        ],
        planName: 'Pro',
      },
    });
    expect(snapshot.planName).toBe('Pro');
    // primary = TOKENS_LIMIT，已用% = (40000000-26371635)/40000000*100 = 34.08...
    expect(snapshot.primary?.type).toBe('TOKENS_LIMIT');
    expect(snapshot.primary?.usedPercent).toBeCloseTo(34.08, 1);
    expect(snapshot.primary?.windowMinutes).toBe(300);
    expect(snapshot.primary?.resetsAtMs).toBe(1768507567547);
    // secondary = TIME_LIMIT
    expect(snapshot.secondary?.type).toBe('TIME_LIMIT');
    expect(snapshot.secondary?.usageDetails[0]?.modelCode).toBe('search-prime');
  });

  test('three limits — primary 取最长 TOKENS 窗口, session 归 secondary', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25, nextResetTime: 1775020168897 },
          { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 9, nextResetTime: 1775588029998 },
          { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 224, remaining: 776, percentage: 22 },
        ],
        level: 'pro',
      },
    });
    // 两个 TOKENS_LIMIT：最长窗口(weeks=10080min)为 primary，最短(hours=300min)为 secondary
    expect(snapshot.primary?.windowMinutes).toBe(10080);
    expect(snapshot.primary?.usedPercent).toBe(9);
    expect(snapshot.secondary?.windowMinutes).toBe(300);
    expect(snapshot.secondary?.usedPercent).toBe(25);
  });

  test('missing fields — 回退 percentage', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1, nextResetTime: 1770724088678 },
        ],
      },
    });
    expect(snapshot.primary?.usedPercent).toBe(1);
    expect(snapshot.primary?.usage).toBeNull();
    expect(snapshot.primary?.windowMinutes).toBe(300);
    expect(snapshot.secondary).toBeNull();
  });

  test('usedPercent 优先用 (usage-remaining)，缺失则用 currentValue', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: { limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 20, remaining: null, percentage: 25 },
      ] },
    });
    expect(snapshot.primary?.usedPercent).toBe(20);
  });

  test('success without limits — primary/secondary 均 null', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true, data: { planName: 'Pro' },
    });
    expect(snapshot.planName).toBe('Pro');
    expect(snapshot.primary).toBeNull();
    expect(snapshot.secondary).toBeNull();
  });

  test('throws when code !== 200 / success false', () => {
    expect(() => normalizeZaiUsage({ code: 1001, msg: 'Authorization Token Missing', success: false }))
      .toThrow('Authorization Token Missing');
  });

  test('throws when success but no data', () => {
    expect(() => normalizeZaiUsage({ code: 200, msg: 'Operation successful', success: true }))
      .toThrow('Missing data');
  });
});

describe('zai-usage parseZaiLimitUnit', () => {
  test('maps unit codes', () => {
    expect(parseZaiLimitUnit(1)).toEqual({ minutes: 1, label: 'minute' });
    expect(parseZaiLimitUnit(3)).toEqual({ minutes: 300, label: '5 hour' });
    expect(parseZaiLimitUnit(5)).toEqual({ minutes: 1440, label: '1 day' });
    expect(parseZaiLimitUnit(6)).toEqual({ minutes: 10080, label: '1 week' });
    expect(parseZaiLimitUnit(0)).toEqual({ minutes: null, label: null });
    expect(parseZaiLimitUnit(undefined)).toEqual({ minutes: null, label: null });
  });
});
