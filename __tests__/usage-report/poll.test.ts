import { runOnce } from '@/usage-report/poll';
import { AggregateConfig, ProviderOverrides } from '@/usage-report/types';
import { Notifier, NotifierMessage } from '@/shared/notifiers/types';

const PROVIDERS: ProviderOverrides = {
  claude: { windows: ['five_hour', 'seven_day'] },
  codex: { windows: ['primary', 'secondary'] },
  minimax: { windows: ['interval', 'weekly'] },
};

const CONFIG: AggregateConfig = {
  poll: { interval_seconds: 900 },
  channels: [],
  providers: PROVIDERS,
};

function makeNotifier(name: string, behavior: 'ok' | 'fail'): Notifier & { calls: NotifierMessage[] } {
  const calls: NotifierMessage[] = [];
  return {
    name,
    async send(msg: NotifierMessage) {
      calls.push(msg);
      if (behavior === 'fail') throw new Error(`${name} 发送失败`);
    },
    get calls() {
      return calls;
    },
  } as unknown as Notifier & { calls: NotifierMessage[] };
}

describe('runOnce', () => {
  it('聚合后每个 notifier.send 只被调用 1 次（单卡），成功通道收到的 level=info', async () => {
    const good = makeNotifier('good', 'ok');
    const logs: string[] = [];
    const errs: string[] = [];
    await runOnce({
      config: CONFIG,
      notifiers: [good],
      logLine: (l) => logs.push(l),
      logError: (l) => errs.push(l),
      collectOptions: {
        fetchers: {
          claude: async () => ({ title: 'c', content: 'claude', level: 'info', summaryLine: 'c-ok' }),
          codex: async () => ({ title: 'c', content: 'codex', level: 'info', summaryLine: 'co-ok' }),
          minimax: async () => ({ title: 'c', content: 'mm', level: 'info', summaryLine: 'mm-ok' }),        },
      },
    });
    expect(good.calls).toHaveLength(1);
    expect(good.calls[0].level).toBe('info');
    expect(good.calls[0].title).toContain('汇总');
  });

  it('任一 provider warn 时卡片 level=warn（红 header）', async () => {
    const good = makeNotifier('good', 'ok');
    await runOnce({
      config: CONFIG,
      notifiers: [good],
      logLine: () => {},
      logError: () => {},
      collectOptions: {
        fetchers: {
          claude: async () => ({ title: 'c', content: 'claude', level: 'warn', summaryLine: 'c-warn' }),
          codex: async () => ({ title: 'c', content: 'codex', level: 'info', summaryLine: 'co-ok' }),
          minimax: async () => ({ title: 'c', content: 'mm', level: 'info', summaryLine: 'mm-ok' }),        },
      },
    });
    expect(good.calls[0].level).toBe('warn');
    expect(good.calls[0].title).toContain('告警');
  });

  it('collect 内部有 provider 失败仍正常发卡（单次 send），失败 provider 体现在 content', async () => {
    const good = makeNotifier('good', 'ok');
    await runOnce({
      config: CONFIG,
      notifiers: [good],
      logLine: () => {},
      logError: () => {},
      collectOptions: {
        fetchers: {
          claude: async () => { throw new Error('keychain 不可用'); },
          codex: async () => ({ title: 'c', content: 'codex', level: 'info', summaryLine: 'co-ok' }),
          minimax: async () => { throw new Error('401'); },        },
      },
    });
    expect(good.calls).toHaveLength(1);
    expect(good.calls[0].content).toContain('⚠️ 获取失败：keychain 不可用');
    expect(good.calls[0].content).toContain('⚠️ 获取失败：401');
  });

  it('失败的 notifier 记 error 日志但不抛出', async () => {
    const good = makeNotifier('good', 'ok');
    const bad = makeNotifier('bad', 'fail');
    const errs: string[] = [];
    await runOnce({
      config: CONFIG,
      notifiers: [good, bad],
      logLine: () => {},
      logError: (l) => errs.push(l),
      collectOptions: {
        fetchers: {
          claude: async () => ({ title: 'c', content: 'claude', level: 'info', summaryLine: 'c-ok' }),
          codex: async () => ({ title: 'c', content: 'codex', level: 'info', summaryLine: 'co-ok' }),
          minimax: async () => ({ title: 'c', content: 'mm', level: 'info', summaryLine: 'mm-ok' }),        },
      },
    });
    expect(good.calls).toHaveLength(1);
    expect(bad.calls).toHaveLength(1); // bad 也被调用了
    expect(errs.some((e) => e.includes('bad'))).toBe(true);
  });

  it('logLine 收到的行含 summaryLine（含各 provider 摘要与 ERROR 标记）', async () => {
    const logs: string[] = [];
    await runOnce({
      config: CONFIG,
      notifiers: [makeNotifier('good', 'ok')],
      logLine: (l) => logs.push(l),
      logError: () => {},
      collectOptions: {
        fetchers: {
          claude: async () => ({ title: 'c', content: 'claude', level: 'info', summaryLine: 'c-ok' }),
          codex: async () => { throw new Error('401'); },
          minimax: async () => ({ title: 'c', content: 'mm', level: 'info', summaryLine: 'mm-ok' }),        },
      },
    });
    expect(logs[0]).toContain('claude=c-ok');
    expect(logs[0]).toContain('codex=ERROR:401');
    expect(logs[0]).toContain('minimax=mm-ok');
  });
});
