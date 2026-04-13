import { getUsageSnapshot } from '../../src/codex-usage/usage';

describe('codex-usage/usage', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requests usage from ChatGPT backend with account header', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          plan_type: 'pro',
          rate_limit: {
            primary_window: {
              used_percent: 2,
              limit_window_seconds: 18000,
              reset_at: 1775670982,
            },
            secondary_window: {
              used_percent: 13,
              limit_window_seconds: 604800,
              reset_at: 1776221738,
            },
          },
          additional_rate_limits: [],
          credits: {
            has_credits: false,
            unlimited: false,
            balance: '0',
          },
        }),
    }) as typeof fetch;

    const snapshot = await getUsageSnapshot({
      accessToken: 'access-token',
      accountId: 'workspace-123',
      baseUrl: 'https://chatgpt.com/backend-api',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'ChatGPT-Account-Id': 'workspace-123',
        }),
      })
    );
    expect(snapshot.planType).toBe('pro');
    expect(snapshot.primary?.usedPercent).toBe(2);
    expect(snapshot.secondary?.windowMinutes).toBe(10080);
  });
});
