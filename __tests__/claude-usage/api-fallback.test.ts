import { fetchUsageWithFallback } from '../../src/claude-usage/api';
import { UsageData } from '../../src/claude-usage/types';

// 把 hud-snapshot 整个 mock 掉，单独验证 fetchUsageWithFallback 的回退编排
jest.mock('../../src/claude-usage/hud-snapshot', () => ({
  readClaudeHudSnapshot: jest.fn(),
  defaultSnapshotPath: jest.fn(() => '/fake/snapshot.json'),
  DEFAULT_SNAPSHOT_FRESHNESS_MS: 300000,
}));
import { readClaudeHudSnapshot } from '../../src/claude-usage/hud-snapshot';

const mockedReadSnapshot = readClaudeHudSnapshot as jest.MockedFunction<
  typeof readClaudeHudSnapshot
>;

const fakeSnapshot: UsageData = {
  fiveHour: { utilization: 42, resetsAt: '2026-07-17T12:00:00.000Z' },
  sevenDay: { utilization: 28, resetsAt: '2026-07-23T07:00:00.000Z' },
  sevenDaySonnet: null,
  sevenDayOpus: null,
  sevenDayCowork: null,
  extraUsage: null,
};

describe('claude-usage/api fetchUsageWithFallback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockedReadSnapshot.mockReset();
  });

  it('API 成功时直接返回，不读取快照', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          five_hour: { utilization: 10, resets_at: '2026-07-17T12:00:00.000Z' },
          seven_day: { utilization: 20, resets_at: '2026-07-23T07:00:00.000Z' },
        }),
    });
    mockedReadSnapshot.mockReturnValue(fakeSnapshot);

    const result = await fetchUsageWithFallback('token');

    expect(result.fiveHour.utilization).toBe(10);
    expect(mockedReadSnapshot).not.toHaveBeenCalled();
  });

  it('API 被限流(429)时回退到 claude-hud 快照', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('rate limited by Anthropic'),
    });
    mockedReadSnapshot.mockReturnValue(fakeSnapshot);

    const result = await fetchUsageWithFallback('token');

    expect(result).toBe(fakeSnapshot);
    expect(mockedReadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('API 失败且快照不可用时抛出原始 API 错误', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('rate limited'),
    });
    mockedReadSnapshot.mockReturnValue(null);

    await expect(fetchUsageWithFallback('token')).rejects.toThrow('429');
  });

  it('API 抛出网络错误时同样回退到快照', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    mockedReadSnapshot.mockReturnValue(fakeSnapshot);

    const result = await fetchUsageWithFallback('token');

    expect(result).toBe(fakeSnapshot);
  });
});
