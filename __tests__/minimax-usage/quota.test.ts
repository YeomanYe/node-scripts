import { extractJsonPayload, normalizeQuota } from '../../src/minimax-usage/quota';

describe('minimax-usage quota', () => {
  test('extracts JSON after mmx region prelude', () => {
    const raw = extractJsonPayload(`Detecting region... cn
{
  "model_remains": [],
  "base_resp": { "status_code": 0 }
}`);
    expect(raw.base_resp).toEqual({ status_code: 0 });
  });

  test('normalizes model remains', () => {
    const snapshot = normalizeQuota({
      model_remains: [
        {
          model_name: 'general',
          current_interval_remaining_percent: 97,
          current_weekly_remaining_percent: 100,
          end_time: 1781265600000,
          weekly_end_time: 1781452800000,
        },
      ],
    });
    expect(snapshot.models[0]?.modelName).toBe('general');
    expect(snapshot.models[0]?.interval.usedPercent).toBe(3);
    expect(snapshot.models[0]?.weekly.usedPercent).toBe(0);
  });
});
