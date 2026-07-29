import { collectAllReports } from '@/usage-report/collect';
import { ProviderResult } from '@/usage-report/types';
import { PollReportLike } from '@/usage-report/types';

function report(key: string): PollReportLike {
  return { title: `${key} title`, content: `${key} body`, level: 'info', summaryLine: `${key}-summary` };
}

describe('collectAllReports', () => {
  it('并行触发 4 个 fetcher，结果顺序固定为 [claude, codex, minimax, zai]', async () => {
    const calls: string[] = [];
    const fetchers = {
      claude: async () => { calls.push('claude'); return report('claude'); },
      codex: async () => { calls.push('codex'); return report('codex'); },
      minimax: async () => { calls.push('minimax'); return report('minimax'); },
      zai: async () => { calls.push('zai'); return report('zai'); },
    };
    const results = await collectAllReports({ nowMs: 0, fetchers });
    expect(calls).toEqual(expect.arrayContaining(['claude', 'codex', 'minimax', 'zai']));
    expect(results.map((r) => r.key)).toEqual(['claude', 'codex', 'minimax', 'zai']);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('单个 provider reject 不致命：claude 失败，其余 3 个仍 ok', async () => {
    const results = await collectAllReports({
      nowMs: 0,
      fetchers: {
        claude: async () => { throw new Error('keychain 不可用'); },
        codex: async () => report('codex'),
        minimax: async () => report('minimax'),
        zai: async () => report('zai'),
      },
    });
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ status: 'error', key: 'claude', message: 'keychain 不可用' });
    expect(results[1].status).toBe('ok');
    expect(results[2].status).toBe('ok');
    expect(results[3].status).toBe('ok');
  });

  it('多个 provider 同时 reject：各自 error message 都保留', async () => {
    const results = await collectAllReports({
      nowMs: 0,
      fetchers: {
        claude: async () => report('claude'),
        codex: async () => { throw new Error('401 未授权'); },
        minimax: async () => report('minimax'),
        zai: async () => { throw new Error('网络超时'); },
      },
    });
    expect(results[1]).toEqual({ status: 'error', key: 'codex', message: '401 未授权' });
    expect(results[3]).toEqual({ status: 'error', key: 'zai', message: '网络超时' });
    expect(results[0].status).toBe('ok');
    expect(results[2].status).toBe('ok');
  });

  it('非 Error 的 reject 原因也能转成 message 字符串', async () => {
    const results = await collectAllReports({
      nowMs: 0,
      fetchers: {
        claude: async () => report('claude'),
        codex: async () => { throw 'string reason'; },
        minimax: async () => report('minimax'),
        zai: async () => report('zai'),
      },
    });
    expect(results[1]).toEqual({ status: 'error', key: 'codex', message: 'string reason' });
  });

  it('ok 的 report 完整保留（title/content/level/summaryLine）', async () => {
    const results = await collectAllReports({
      nowMs: 0,
      fetchers: {
        claude: async () => ({ title: 'T', content: 'C', level: 'warn' as const, summaryLine: 'S' }),
        codex: async () => report('codex'),
        minimax: async () => report('minimax'),
        zai: async () => report('zai'),
      },
    });
    const claude = results[0];
    expect(claude.status).toBe('ok');
    if (claude.status === 'ok') {
      expect(claude.report).toEqual({ title: 'T', content: 'C', level: 'warn', summaryLine: 'S' });
    }
  });

  it('结果类型满足 ProviderResult[]', async () => {
    const results: ProviderResult[] = await collectAllReports({
      nowMs: 0,
      fetchers: {
        claude: async () => report('claude'),
        codex: async () => report('codex'),
        minimax: async () => report('minimax'),
        zai: async () => report('zai'),
      },
    });
    expect(results).toHaveLength(4);
    // 类型层面已校验为 ProviderResult[]
    results.forEach((r) => {
      expect(['ok', 'error']).toContain(r.status);
    });
  });

  it('queries only providers enabled by the CodexBar menu configuration, preserving its order', async () => {
    const calls: string[] = [];
    const results = await collectAllReports({
      nowMs: 0,
      codexBarSettingsReader: async () => ({
        enabledProviders: ['codex', 'claude', 'minimax'],
        metricPreferences: {
          codex: 'primary',
          claude: 'primary',
          minimax: 'primary',
        },
      }),
      codexBarProviderFetcher: async (provider) => {
        calls.push(provider);
        return [
          {
            provider,
            usage: {
              primary: {
                usedPercent: 10,
                windowMinutes: 300,
                resetsAt: new Date(150 * 60 * 1000).toISOString(),
              },
            },
          },
        ];
      },
    });

    expect(calls).toEqual(['codex', 'claude', 'minimax']);
    expect(calls).not.toContain('zai');
    expect(results.map((result) => result.key)).toEqual(['codex', 'claude', 'minimax']);
  });

  it('keeps another CodexBar provider available when one enabled provider fails', async () => {
    const results = await collectAllReports({
      nowMs: 0,
      codexBarSettingsReader: async () => ({
        enabledProviders: ['claude', 'minimax'],
        metricPreferences: {
          claude: 'primary',
          minimax: 'primary',
        },
      }),
      codexBarProviderFetcher: async (provider) => {
        if (provider === 'claude') throw new Error('Claude unavailable');
        return [
          {
            provider,
            usage: {
              primary: {
                usedPercent: 10,
                windowMinutes: 300,
                resetsAt: new Date(150 * 60 * 1000).toISOString(),
              },
            },
          },
        ];
      },
    });

    expect(results[0]).toEqual({
      status: 'error',
      key: 'claude',
      message: 'Claude unavailable',
    });
    expect(results[1].status).toBe('ok');
  });

  it('fails clearly instead of querying a hard-coded fallback when CodexBar enables nothing', async () => {
    await expect(
      collectAllReports({
        nowMs: 0,
        codexBarSettingsReader: async () => ({
          enabledProviders: [],
          metricPreferences: {},
        }),
      })
    ).rejects.toThrow(/CodexBar.*没有启用/);
  });
});
