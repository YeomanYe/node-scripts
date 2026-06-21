import { extractJsonPayload, normalizeQuota, DEFAULT_MINIMAX_HOST } from '@/minimax-usage/quota';

describe('minimax-usage quota normalize', () => {
  test('extracts model_remains from wrapped data envelope', () => {
    const raw = extractJsonPayload(`{"base_resp":{"status_code":0},"data":{"model_remains":[],"plan_name":"Plus"}}`);
    expect(raw.data?.model_remains).toEqual([]);
    expect(raw.data?.plan_name).toBe('Plus');
  });

  test('normalizes model remains', () => {
    const snapshot = normalizeQuota({
      base_resp: { status_code: 0 },
      data: {
        plan_name: 'Plus',
        model_remains: [
          {
            model_name: 'general',
            current_interval_remaining_percent: 97,
            current_weekly_remaining_percent: 100,
            end_time: 1781265600000,
            start_time: 1781265600000 - 5 * 60 * 60 * 1000,
            weekly_end_time: 1781452800000,
            weekly_start_time: 1781452800000 - 7 * 24 * 60 * 60 * 1000,
          },
        ],
      },
    });
    expect(snapshot.planName).toBe('Plus');
    expect(snapshot.models[0]?.modelName).toBe('general');
    expect(snapshot.models[0]?.interval.usedPercent).toBe(3);
    expect(snapshot.models[0]?.weekly.usedPercent).toBe(0);
  });

  test('throws when base_resp status_code !== 0', () => {
    expect(() => normalizeQuota({ base_resp: { status_code: 1004, status_msg: 'login required' }, data: { model_remains: [] } }))
      .toThrow(/login required|凭据/);
  });

  test('throws when model_remains empty', () => {
    expect(() => normalizeQuota({ base_resp: { status_code: 0 }, data: { model_remains: [] } }))
      .toThrow(/Missing|未返回/);
  });
});

describe('minimax-usage default host', () => {
  test('is china mainland api host', () => {
    expect(DEFAULT_MINIMAX_HOST).toBe('https://api.minimaxi.com');
  });
});
