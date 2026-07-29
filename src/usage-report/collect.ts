import {
  buildCodexBarProviderReport,
  CodexBarSettings,
  CodexBarUsageEntry,
  fetchCodexBarProviderEntries,
  readCodexBarSettings,
} from './codexbar';
import { PollReportLike, ProviderKey, ProviderResult } from './types';

/** 测试可注入的 fetcher：返回该 provider 的已构造 PollReport */
export type ProviderFetcher = () => Promise<PollReportLike>;

export interface CollectOptions {
  /** 当前时间戳（传给 CodexBar report builder） */
  nowMs: number;
  /** 可选：直接注入已构造的 provider report（测试用） */
  fetchers?: Partial<Record<ProviderKey, ProviderFetcher>>;
  /** 可选：注入 CodexBar 设置读取器（测试用） */
  codexBarSettingsReader?: () => Promise<CodexBarSettings>;
  /** 可选：注入单 provider 的 CodexBar 用量读取器（测试用） */
  codexBarProviderFetcher?: (provider: string) => Promise<CodexBarUsageEntry[]>;
}

/** 仅用于保持旧测试注入的稳定顺序；真实运行顺序完全来自 CodexBar config.json。 */
const LEGACY_TEST_ORDER = ['claude', 'codex', 'minimax', 'zai'] as const;

function orderedInjectedProviders(
  fetchers: Partial<Record<ProviderKey, ProviderFetcher>>
): ProviderKey[] {
  const keys = Object.keys(fetchers);
  return [
    ...LEGACY_TEST_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !LEGACY_TEST_ORDER.includes(key as typeof LEGACY_TEST_ORDER[number])),
  ];
}

async function settleReports(
  providers: ProviderKey[],
  fetcherFor: (provider: ProviderKey) => ProviderFetcher
): Promise<ProviderResult[]> {
  const settled = await Promise.allSettled(
    providers.map((provider) => fetcherFor(provider)())
  );

  return providers.map((key, index) => {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      return { status: 'ok' as const, key, report: result.value };
    }
    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    return { status: 'error' as const, key, message };
  });
}

/**
 * 真实运行时先读取 CodexBar 的菜单栏配置：
 * - `~/.codexbar/config.json` 决定查询哪些 provider 以及展示顺序；
 * - plist 的 `menuBarMetricPreferences` 决定每个 provider 查询后展示哪个配额；
 * - 每个启用项均通过 CodexBar CLI 获取标准化用量。
 */
export async function collectAllReports(options: CollectOptions): Promise<ProviderResult[]> {
  if (options.fetchers) {
    const providers = orderedInjectedProviders(options.fetchers);
    return settleReports(providers, (provider) => {
      const fetcher = options.fetchers?.[provider];
      return fetcher ?? (async () => {
        throw new Error(`缺少 ${provider} fetcher`);
      });
    });
  }

  const settingsReader = options.codexBarSettingsReader ?? readCodexBarSettings;
  const providerFetcher =
    options.codexBarProviderFetcher ?? fetchCodexBarProviderEntries;
  const settings = await settingsReader();

  if (settings.enabledProviders.length === 0) {
    throw new Error('CodexBar 菜单栏没有启用任何 provider');
  }

  return settleReports(settings.enabledProviders, (provider) => async () => {
    const entries = await providerFetcher(provider);
    return buildCodexBarProviderReport(provider, entries, {
      metricPreference: settings.metricPreferences[provider] ?? 'primary',
      nowMs: options.nowMs,
    });
  });
}
