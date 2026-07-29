import {
  CODEXBAR_CODEX_USAGE_ARGS,
  buildCodexBarPollReport,
  fetchCodexBarAccountResults,
  parseCodexBarAccountResults,
  readCodexBarMetricPreference,
} from '@/usage-report/codexbar';

const NOW_SEC = 1_800_000_000;
const NOW_MS = NOW_SEC * 1000;

function codexEntry(
  account: string,
  options: {
    plan?: string;
    primary?: { usedPercent: number; windowMinutes: number; resetsAt: string } | null;
    secondary?: { usedPercent: number; windowMinutes: number; resetsAt: string } | null;
  } = {}
): Record<string, unknown> {
  const plan = options.plan ?? 'plus';
  return {
    provider: 'codex',
    account,
    source: 'codex-cli',
    usage: {
      accountEmail: account,
      loginMethod: plan,
      identity: {
        accountEmail: account,
        loginMethod: plan,
      },
      primary: options.primary ?? null,
      secondary: options.secondary ?? null,
    },
  };
}

describe('usage-report CodexBar multi-account collection', () => {
  it('reads the Codex metric preference from the same CodexBar plist key as ty-vibe-kanban', async () => {
    const calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
    const preference = await readCodexBarMetricPreference({
      plistPath: '/tmp/com.steipete.codexbar.plist',
      runner: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return JSON.stringify({
          claude: 'secondary',
          codex: 'primary',
        });
      },
    });

    expect(calls).toEqual([
      {
        command: 'plutil',
        args: [
          '-extract',
          'menuBarMetricPreferences',
          'json',
          '-o',
          '-',
          '/tmp/com.steipete.codexbar.plist',
        ],
        timeoutMs: 5_000,
      },
    ]);
    expect(preference).toBe('primary');
  });

  it('treats an unreadable or malformed CodexBar metric preference as unavailable', async () => {
    await expect(
      readCodexBarMetricPreference({
        runner: async () => {
          throw new Error('plist unavailable');
        },
      })
    ).resolves.toBeUndefined();

    await expect(
      readCodexBarMetricPreference({
        runner: async () => JSON.stringify({ codex: 123 }),
      })
    ).resolves.toBeUndefined();
  });

  it('uses the same CodexBar CLI arguments as ty-vibe-kanban and parses every account', async () => {
    const calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
    const stdout = JSON.stringify([
      codexEntry('alice@example.com', {
        secondary: {
          usedPercent: 21,
          windowMinutes: 10_080,
          resetsAt: new Date((NOW_SEC + 5_040 * 60) * 1000).toISOString(),
        },
      }),
      codexEntry('bob@example.com', {
        primary: {
          usedPercent: 7,
          windowMinutes: 300,
          resetsAt: new Date((NOW_SEC + 150 * 60) * 1000).toISOString(),
        },
      }),
    ]);

    const results = await fetchCodexBarAccountResults({
      runner: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return stdout;
      },
    });

    expect(calls).toEqual([
      {
        command: 'codexbar',
        args: CODEXBAR_CODEX_USAGE_ARGS,
        timeoutMs: 40_000,
      },
    ]);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.accountLabel)).toEqual(['alice', 'bob']);
    expect(results[0]).toMatchObject({
      status: 'ok',
      snapshot: {
        planType: 'plus',
        secondary: {
          usedPercent: 21,
          windowMinutes: 10_080,
          resetsAt: NOW_SEC + 5_040 * 60,
        },
      },
    });
    expect(results[1]).toMatchObject({
      status: 'ok',
      snapshot: {
        primary: {
          usedPercent: 7,
          windowMinutes: 300,
          resetsAt: NOW_SEC + 150 * 60,
        },
      },
    });
  });

  it('builds one Codex block containing every account, including accounts with different windows', () => {
    const results = parseCodexBarAccountResults(
      JSON.stringify([
        codexEntry('alice@example.com', {
          plan: 'pro',
          secondary: {
            usedPercent: 80,
            windowMinutes: 10_080,
            resetsAt: new Date((NOW_SEC + 5_040 * 60) * 1000).toISOString(),
          },
        }),
        codexEntry('very-long-bob-name@example.com', {
          primary: {
            usedPercent: 10,
            windowMinutes: 300,
            resetsAt: new Date((NOW_SEC + 150 * 60) * 1000).toISOString(),
          },
        }),
      ])
    );

    const report = buildCodexBarPollReport(results, {
      windows: ['primary', 'secondary'],
      metricPreference: 'primary',
      nowMs: NOW_MS,
    });

    expect(report.level).toBe('warn');
    expect(report.content).toContain('**账号数**：2 ｜ **CodexBar 配额偏好**：Primary');
    expect(report.content).toContain('**账号**：alice ｜ **Plan**：pro');
    expect(report.content).toContain('Secondary：80.0%');
    expect(report.content).toContain('**账号**：very-long-… ｜ **Plan**：plus');
    expect(report.content).toContain('Primary：10.0%');
    expect(report.summaryLine).toContain('alice[');
    expect(report.summaryLine).toContain('very-long-…[');
    expect(report.summaryLine).toContain('preference=primary');
  });

  it('uses only the preferred CodexBar quota for display and alerting when it is available', () => {
    const results = parseCodexBarAccountResults(
      JSON.stringify([
        codexEntry('alice@example.com', {
          primary: {
            usedPercent: 10,
            windowMinutes: 300,
            resetsAt: new Date((NOW_SEC + 150 * 60) * 1000).toISOString(),
          },
          secondary: {
            usedPercent: 80,
            windowMinutes: 10_080,
            resetsAt: new Date((NOW_SEC + 5_040 * 60) * 1000).toISOString(),
          },
        }),
      ])
    );

    const report = buildCodexBarPollReport(results, {
      windows: ['primary', 'secondary'],
      metricPreference: 'primary',
      nowMs: NOW_MS,
    });

    expect(report.level).toBe('info');
    expect(report.content).toContain('Primary：10.0%');
    expect(report.content).not.toContain('Secondary：80.0%');
    expect(report.summaryLine).toContain('primary=10.0%');
    expect(report.summaryLine).not.toContain('secondary=80.0%');
  });

  it('matches CodexBar carousel behavior by resolving the first available quota', () => {
    const results = parseCodexBarAccountResults(
      JSON.stringify([
        codexEntry('alice@example.com', {
          primary: {
            usedPercent: 10,
            windowMinutes: 300,
            resetsAt: new Date((NOW_SEC + 150 * 60) * 1000).toISOString(),
          },
          secondary: {
            usedPercent: 80,
            windowMinutes: 10_080,
            resetsAt: new Date((NOW_SEC + 5_040 * 60) * 1000).toISOString(),
          },
        }),
      ])
    );

    const report = buildCodexBarPollReport(results, {
      windows: ['primary', 'secondary'],
      metricPreference: 'carousel',
      nowMs: NOW_MS,
    });

    expect(report.content).toContain('Primary：10.0%');
    expect(report.content).not.toContain('Secondary：80.0%');
  });

  it('keeps a per-account error visible when another account succeeds', () => {
    const results = parseCodexBarAccountResults(
      JSON.stringify([
        codexEntry('alice@example.com', {
          secondary: {
            usedPercent: 20,
            windowMinutes: 10_080,
            resetsAt: new Date((NOW_SEC + 8_064 * 60) * 1000).toISOString(),
          },
        }),
        {
          provider: 'codex',
          account: 'bob@example.com',
          error: 'account unavailable',
        },
      ])
    );

    const report = buildCodexBarPollReport(results, {
      windows: ['primary', 'secondary'],
      nowMs: NOW_MS,
    });

    expect(report.content).toContain('**账号**：alice');
    expect(report.content).toContain('**账号**：bob');
    expect(report.content).toContain('⚠️ 获取失败：account unavailable');
    expect(report.summaryLine).toContain('bob[ERROR:account unavailable]');
  });

  it('does not duplicate the single-account report header when no windows are selected', () => {
    const results = parseCodexBarAccountResults(
      JSON.stringify([
        codexEntry('alice@example.com', {
          secondary: {
            usedPercent: 20,
            windowMinutes: 10_080,
            resetsAt: new Date((NOW_SEC + 8_064 * 60) * 1000).toISOString(),
          },
        }),
      ])
    );

    const report = buildCodexBarPollReport(results, {
      windows: [],
      nowMs: NOW_MS,
    });

    expect(report.content.match(/\*\*Plan\*\*/g)).toHaveLength(1);
    expect(report.content).not.toContain('**当前时间**');
  });

  it('rejects empty, malformed, or non-Codex output without echoing raw account data', () => {
    expect(() => parseCodexBarAccountResults('[]')).toThrow(/未返回.*Codex.*账号/);
    expect(() =>
      parseCodexBarAccountResults(JSON.stringify([{ provider: 'claude', account: 'private@example.com' }]))
    ).toThrow(/未返回.*Codex.*账号/);

    try {
      parseCodexBarAccountResults('private@example.com is not json');
      throw new Error('expected parse to fail');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/JSON/);
      expect(message).not.toContain('private@example.com');
    }
  });
});
