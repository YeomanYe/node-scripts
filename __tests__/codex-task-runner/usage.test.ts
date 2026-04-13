import { resolveParallelism, getParallelism } from '../../src/codex-task-runner/usage';
import { RunnerConfig } from '../../src/codex-task-runner/types';

jest.mock('../../src/codex-usage/auth', () => ({
  loadLocalAuth: jest.fn(),
}));

jest.mock('../../src/codex-usage/usage', () => ({
  getUsageSnapshot: jest.fn(),
}));

jest.mock('../../src/codex-task-runner/log', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

import { loadLocalAuth } from '../../src/codex-usage/auth';
import { getUsageSnapshot } from '../../src/codex-usage/usage';

const mockedLoadLocalAuth = loadLocalAuth as jest.MockedFunction<typeof loadLocalAuth>;
const mockedGetUsageSnapshot = getUsageSnapshot as jest.MockedFunction<typeof getUsageSnapshot>;

describe('codex-task-runner/usage', () => {
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
      model: 'gpt-5.4',
      sandbox_mode: 'workspace-write',
      dangerously_bypass_approvals_and_sandbox: false,
      timeout_minutes: 30,
      on_failure: 'continue',
    },
  };

  it('should resolve thresholds', () => {
    expect(resolveParallelism(10, defaultConfig)).toBe(4);
    expect(resolveParallelism(40, defaultConfig)).toBe(3);
    expect(resolveParallelism(60, defaultConfig)).toBe(2);
    expect(resolveParallelism(90, defaultConfig)).toBe(0);
  });

  it('should prefer configured rules when provided', () => {
    const customConfig: RunnerConfig = {
      ...defaultConfig,
      parallelism: {
        rules: [
          { max_usage: 15, concurrency: 5 },
          { max_usage: 55, concurrency: 2 },
          { max_usage: 80, concurrency: 1 },
        ],
        below_30: 4,
        below_50: 3,
        below_80: 2,
        above_80: 0,
      },
    };

    expect(resolveParallelism(10, customConfig)).toBe(5);
    expect(resolveParallelism(15, customConfig)).toBe(2);
    expect(resolveParallelism(54.9, customConfig)).toBe(2);
    expect(resolveParallelism(79.9, customConfig)).toBe(1);
    expect(resolveParallelism(80, customConfig)).toBe(0);
  });

  it('should use primary usage window', async () => {
    mockedLoadLocalAuth.mockResolvedValue({
      accessToken: 'access-token',
      accountId: 'workspace-123',
      planType: 'pro',
    });
    mockedGetUsageSnapshot.mockResolvedValue({
      planType: 'pro',
      primary: { usedPercent: 25, windowMinutes: 300, resetsAt: 1775670982 },
      secondary: { usedPercent: 50, windowMinutes: 10080, resetsAt: 1776221738 },
      additional: [],
      raw: {},
    });

    const result = await getParallelism(defaultConfig);

    expect(result.parallelism).toBe(4);
    expect(result.usage).toBe(25);
  });

  it('should fall back conservatively when auth or API fails', async () => {
    mockedLoadLocalAuth.mockRejectedValue(new Error('missing auth'));

    const result = await getParallelism(defaultConfig);

    expect(result.parallelism).toBe(1);
    expect(result.usage).toBe(-1);
  });
});
