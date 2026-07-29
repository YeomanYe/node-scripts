import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  CODEXBAR_CODEX_USAGE_ARGS,
  CodexBarUsageEntry,
  buildCodexBarProviderReport,
  fetchCodexBarProviderEntries,
  getCodexBarProviderUsageArgs,
  parseCodexBarProviderEntries,
  readCodexBarEnabledProviders,
  readCodexBarMetricPreference,
  readCodexBarMetricPreferences,
} from '@/usage-report/codexbar';

const NOW_SEC = 1_800_000_000;
const NOW_MS = NOW_SEC * 1000;

interface TestWindow {
  [key: string]: unknown;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: string;
}

function testWindow(
  usedPercent: number,
  windowMinutes: number,
  remainingMinutes: number
): TestWindow {
  return {
    usedPercent,
    windowMinutes,
    resetsAt: new Date((NOW_SEC + remainingMinutes * 60) * 1000).toISOString(),
  };
}

function usageEntry(
  provider: string,
  options: {
    account?: string;
    loginMethod?: string;
    primary?: TestWindow | null;
    secondary?: TestWindow | null;
    tertiary?: TestWindow | null;
    error?: unknown;
  } = {}
): CodexBarUsageEntry {
  if (options.error !== undefined) {
    return {
      provider,
      account: options.account ?? null,
      error: options.error,
    };
  }

  return {
    provider,
    account: options.account ?? null,
    usage: {
      accountEmail: options.account ?? null,
      loginMethod: options.loginMethod ?? 'api',
      primary: options.primary ?? null,
      secondary: options.secondary ?? null,
      tertiary: options.tertiary ?? null,
    },
  };
}

describe('usage-report CodexBar integration', () => {
  it('reads enabled providers in menu-bar order from the CodexBar config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexbar-config-'));
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        providers: [
          { id: 'codex', enabled: true },
          { id: 'zai', enabled: false },
          { id: 'claude', enabled: true },
          { id: 'minimax', enabled: true },
          { id: 'codex', enabled: true },
        ],
      }),
      'utf8'
    );

    await expect(readCodexBarEnabledProviders({ configPath })).resolves.toEqual([
      'codex',
      'claude',
      'minimax',
    ]);
  });

  it('returns no enabled providers for missing or malformed CodexBar config', async () => {
    await expect(
      readCodexBarEnabledProviders({ configPath: '/missing/codexbar-config.json' })
    ).resolves.toEqual([]);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexbar-config-invalid-'));
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(configPath, '{bad json', 'utf8');
    await expect(readCodexBarEnabledProviders({ configPath })).resolves.toEqual([]);
  });

  it('reads metric preferences for every CodexBar provider', async () => {
    const preferences = await readCodexBarMetricPreferences({
      runner: async () =>
        JSON.stringify({
          claude: 'primary',
          codex: 'secondary',
          minimax: 'carousel',
          zai: 'tertiary',
          invalid: 123,
        }),
    });

    expect(preferences).toEqual({
      claude: 'primary',
      codex: 'secondary',
      minimax: 'carousel',
      zai: 'tertiary',
    });
  });

  it('reads the Codex preference from the same plist key as ty-vibe-kanban', async () => {
    const calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
    const preference = await readCodexBarMetricPreference({
      plistPath: '/tmp/com.steipete.codexbar.plist',
      runner: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return JSON.stringify({ codex: 'primary' });
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

  it('treats an unreadable or malformed metric preference as unavailable', async () => {
    await expect(
      readCodexBarMetricPreferences({
        runner: async () => {
          throw new Error('plist unavailable');
        },
      })
    ).resolves.toEqual({});
    await expect(
      readCodexBarMetricPreferences({
        runner: async () => JSON.stringify(['not', 'a', 'map']),
      })
    ).resolves.toEqual({});
  });

  it('uses the same per-provider CLI arguments as ty-vibe-kanban', () => {
    expect(getCodexBarProviderUsageArgs('claude')).toEqual([
      'usage',
      '--format',
      'json',
      '--provider',
      'claude',
      '--source',
      'oauth',
    ]);
    expect(getCodexBarProviderUsageArgs('codex')).toEqual(CODEXBAR_CODEX_USAGE_ARGS);
    expect(getCodexBarProviderUsageArgs('minimax')).toEqual([
      'usage',
      '--format',
      'json',
      '--provider',
      'minimax',
    ]);
  });

  it('fetches and preserves every account returned for an enabled provider', async () => {
    const calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
    const entries = await fetchCodexBarProviderEntries('codex', {
      runner: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return JSON.stringify([
          usageEntry('codex', {
            account: 'alice@example.com',
            secondary: testWindow(21, 10_080, 5_040),
          }),
          usageEntry('codex', {
            account: 'bob@example.com',
            primary: testWindow(7, 300, 150),
          }),
        ]);
      },
    });

    expect(calls).toEqual([
      {
        command: 'codexbar',
        args: CODEXBAR_CODEX_USAGE_ARGS,
        timeoutMs: 40_000,
      },
    ]);
    expect(entries.map((entry) => entry.account)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('rejects malformed, empty, or wrong-provider output without echoing raw account data', () => {
    expect(() => parseCodexBarProviderEntries('[]', 'codex')).toThrow(/未返回 codex/);
    expect(() =>
      parseCodexBarProviderEntries(
        JSON.stringify([usageEntry('claude', { account: 'private@example.com' })]),
        'codex'
      )
    ).toThrow(/未返回 codex/);

    try {
      parseCodexBarProviderEntries('private@example.com is not json', 'codex');
      throw new Error('expected parse to fail');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/JSON/);
      expect(message).not.toContain('private@example.com');
    }
  });

  it('preserves a provider error returned as CodexBar JSON', async () => {
    const entries = await fetchCodexBarProviderEntries('claude', {
      runner: async () =>
        JSON.stringify([
          usageEntry('claude', {
            error: {
              code: 3,
              message: 'Claude OAuth credentials not found',
            },
          }),
        ]),
    });

    expect(() =>
      buildCodexBarProviderReport('claude', entries, {
        metricPreference: 'primary',
        nowMs: NOW_MS,
      })
    ).toThrow(/Claude OAuth credentials not found/);
  });

  it('builds one multi-account report and falls back per account without hiding it', () => {
    const report = buildCodexBarProviderReport(
      'codex',
      [
        usageEntry('codex', {
          account: 'alice@example.com',
          loginMethod: 'pro',
          secondary: testWindow(80, 10_080, 5_040),
        }),
        usageEntry('codex', {
          account: 'very-long-bob-name@example.com',
          primary: testWindow(10, 300, 150),
        }),
      ],
      {
        metricPreference: 'primary',
        nowMs: NOW_MS,
      }
    );

    expect(report.level).toBe('warn');
    expect(report.content).toContain('**CodexBar 配额偏好**：Primary');
    expect(report.content).toContain('**账号**：alice');
    expect(report.content).toContain('Secondary：80.0%');
    expect(report.content).toContain('**账号**：very-long-…');
    expect(report.content).toContain('Primary：10.0%');
  });

  it('uses only the preferred quota for display and alerting when available', () => {
    const report = buildCodexBarProviderReport(
      'minimax',
      [
        usageEntry('minimax', {
          primary: testWindow(10, 300, 150),
          secondary: testWindow(80, 10_080, 5_040),
        }),
      ],
      {
        metricPreference: 'primary',
        nowMs: NOW_MS,
      }
    );

    expect(report.level).toBe('info');
    expect(report.content).toContain('Primary：10.0%');
    expect(report.content).not.toContain('Secondary：80.0%');
    expect(report.summaryLine).toContain('primary=10.0%');
    expect(report.summaryLine).not.toContain('secondary=80.0%');
  });

  it('matches carousel behavior by resolving the first available quota', () => {
    const report = buildCodexBarProviderReport(
      'minimax',
      [
        usageEntry('minimax', {
          primary: testWindow(10, 300, 150),
          secondary: testWindow(80, 10_080, 5_040),
        }),
      ],
      {
        metricPreference: 'carousel',
        nowMs: NOW_MS,
      }
    );

    expect(report.content).toContain('Primary：10.0%');
    expect(report.content).not.toContain('Secondary：80.0%');
  });

  it('supports the CodexBar-selected tertiary quota', () => {
    const report = buildCodexBarProviderReport(
      'zai',
      [
        usageEntry('zai', {
          primary: testWindow(90, 300, 150),
          tertiary: testWindow(10, 10_080, 5_040),
        }),
      ],
      {
        metricPreference: 'tertiary',
        nowMs: NOW_MS,
      }
    );

    expect(report.level).toBe('info');
    expect(report.content).toContain('**CodexBar 配额偏好**：Tertiary');
    expect(report.content).toContain('Tertiary：10.0%');
    expect(report.content).not.toContain('Primary：90.0%');
    expect(report.summaryLine).toContain('preference=tertiary');
  });

  it('keeps a per-entry error visible when another entry succeeds', () => {
    const report = buildCodexBarProviderReport(
      'codex',
      [
        usageEntry('codex', {
          account: 'alice@example.com',
          secondary: testWindow(20, 10_080, 8_064),
        }),
        usageEntry('codex', {
          account: 'bob@example.com',
          error: 'account unavailable',
        }),
      ],
      {
        metricPreference: 'primary',
        nowMs: NOW_MS,
      }
    );

    expect(report.content).toContain('**账号**：alice');
    expect(report.content).toContain('**账号**：bob');
    expect(report.content).toContain('⚠️ 获取失败：account unavailable');
    expect(report.summaryLine).toContain('bob[ERROR:account unavailable]');
  });
});
