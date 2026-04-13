import { resolveParallelism, getParallelism } from '../../src/claude-task-runner/usage';
import { RunnerConfig } from '../../src/claude-task-runner/types';

// Mock external dependencies
jest.mock('../../src/claude-usage/credentials', () => ({
  getCredentials: jest.fn(),
}));

jest.mock('../../src/claude-usage/api', () => ({
  fetchUsage: jest.fn(),
}));

jest.mock('../../src/claude-task-runner/log', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

import { getCredentials } from '../../src/claude-usage/credentials';
import { fetchUsage } from '../../src/claude-usage/api';

const mockedGetCredentials = getCredentials as jest.MockedFunction<typeof getCredentials>;
const mockedFetchUsage = fetchUsage as jest.MockedFunction<typeof fetchUsage>;

describe('claude-task-runner/usage', () => {
  const defaultConfig: RunnerConfig = {
    feishu: {
      app_id: '',
      app_secret: '',
      domain: 'https://open.feishu.cn',
      receive_id: '',
      receive_id_type: 'chat_id',
    },
    parallelism: {
      below_30: 4,
      below_50: 3,
      below_80: 2,
      above_80: 0,
    },
    defaults: {
      model: 'sonnet',
      max_budget_usd: 5,
      permission_mode: 'bypassPermissions',
      timeout_minutes: 30,
      on_failure: 'continue',
    },
  };

  describe('resolveParallelism', () => {
    it('should return below_30 parallelism when usage < 30%', () => {
      expect(resolveParallelism(0, defaultConfig)).toBe(4);
      expect(resolveParallelism(15, defaultConfig)).toBe(4);
      expect(resolveParallelism(29.9, defaultConfig)).toBe(4);
    });

    it('should return below_50 parallelism when 30% <= usage < 50%', () => {
      expect(resolveParallelism(30, defaultConfig)).toBe(3);
      expect(resolveParallelism(40, defaultConfig)).toBe(3);
      expect(resolveParallelism(49.9, defaultConfig)).toBe(3);
    });

    it('should return below_80 parallelism when 50% <= usage < 80%', () => {
      expect(resolveParallelism(50, defaultConfig)).toBe(2);
      expect(resolveParallelism(65, defaultConfig)).toBe(2);
      expect(resolveParallelism(79.9, defaultConfig)).toBe(2);
    });

    it('should return above_80 parallelism when usage >= 80%', () => {
      expect(resolveParallelism(80, defaultConfig)).toBe(0);
      expect(resolveParallelism(90, defaultConfig)).toBe(0);
      expect(resolveParallelism(100, defaultConfig)).toBe(0);
    });

    it('should use custom parallelism values from legacy config', () => {
      const customConfig: RunnerConfig = {
        ...defaultConfig,
        parallelism: {
          below_30: 10,
          below_50: 7,
          below_80: 3,
          above_80: 1,
        },
      };

      expect(resolveParallelism(10, customConfig)).toBe(10);
      expect(resolveParallelism(40, customConfig)).toBe(7);
      expect(resolveParallelism(60, customConfig)).toBe(3);
      expect(resolveParallelism(90, customConfig)).toBe(1);
    });

    it('should prefer configured rules when provided', () => {
      const customConfig: RunnerConfig = {
        ...defaultConfig,
        parallelism: {
          rules: [
            { max_usage: 20, concurrency: 6 },
            { max_usage: 60, concurrency: 3 },
            { max_usage: 90, concurrency: 1 },
          ],
          above_80: 0,
          below_30: 4,
          below_50: 3,
          below_80: 2,
        },
      };

      expect(resolveParallelism(10, customConfig)).toBe(6);
      expect(resolveParallelism(20, customConfig)).toBe(3);
      expect(resolveParallelism(59.9, customConfig)).toBe(3);
      expect(resolveParallelism(60, customConfig)).toBe(1);
      expect(resolveParallelism(95, customConfig)).toBe(0);
    });
  });

  describe('getParallelism', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return parallelism based on fiveHour utilization', async () => {
      mockedGetCredentials.mockResolvedValue({
        accessToken: 'test-token',
        subscriptionType: 'pro',
        rateLimitTier: 'tier4',
      });
      mockedFetchUsage.mockResolvedValue({
        fiveHour: { utilization: 25, resetsAt: '2026-04-10T05:00:00Z' },
        sevenDay: { utilization: 50, resetsAt: '2026-04-15T00:00:00Z' },
        sevenDaySonnet: null,
        sevenDayOpus: null,
        sevenDayCowork: null,
        extraUsage: null,
      });

      const result = await getParallelism(defaultConfig);

      expect(result.parallelism).toBe(4); // below_30
      expect(result.usage).toBe(25);
    });

    it('should return parallelism 0 for high usage', async () => {
      mockedGetCredentials.mockResolvedValue({
        accessToken: 'test-token',
        subscriptionType: 'pro',
        rateLimitTier: 'tier4',
      });
      mockedFetchUsage.mockResolvedValue({
        fiveHour: { utilization: 85, resetsAt: '2026-04-10T05:00:00Z' },
        sevenDay: { utilization: 50, resetsAt: '2026-04-15T00:00:00Z' },
        sevenDaySonnet: null,
        sevenDayOpus: null,
        sevenDayCowork: null,
        extraUsage: null,
      });

      const result = await getParallelism(defaultConfig);

      expect(result.parallelism).toBe(0); // above_80
      expect(result.usage).toBe(85);
    });

    it('should return fallback parallelism 1 when credentials fail', async () => {
      mockedGetCredentials.mockRejectedValue(new Error('Keychain unavailable'));

      const result = await getParallelism(defaultConfig);

      expect(result.parallelism).toBe(1);
      expect(result.usage).toBe(-1);
    });

    it('should return fallback parallelism 1 when API call fails', async () => {
      mockedGetCredentials.mockResolvedValue({
        accessToken: 'test-token',
        subscriptionType: 'pro',
        rateLimitTier: 'tier4',
      });
      mockedFetchUsage.mockRejectedValue(new Error('Network error'));

      const result = await getParallelism(defaultConfig);

      expect(result.parallelism).toBe(1);
      expect(result.usage).toBe(-1);
    });
  });
});
