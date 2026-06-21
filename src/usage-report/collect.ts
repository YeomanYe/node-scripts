import { getCredentials } from '../claude-usage/credentials';
import { fetchUsage } from '../claude-usage/api';
import { buildPollReport as buildClaudeReport } from '../claude-usage/poll';
import { loadLocalAuth } from '../codex-usage/auth';
import { getUsageSnapshot } from '../codex-usage/usage';
import { buildPollReport as buildCodexReport } from '../codex-usage/poll';
import { readMiniMaxApiKey } from '../minimax-usage/env';
import { fetchMiniMaxQuota } from '../minimax-usage/quota';
import { buildPollReport as buildMiniMaxReport } from '../minimax-usage/poll';
import { readZaiApiKey } from '../zai-usage/env';
import { fetchZaiUsage } from '../zai-usage/quota';
import { buildPollReport as buildZaiReport } from '../zai-usage/poll';
import { PollReportLike, ProviderKey, ProviderOverrides, ProviderResult } from './types';

/** 测试可注入的 fetcher：返回该 provider 的已构造 PollReport */
export type ProviderFetcher = () => Promise<PollReportLike>;

export interface CollectOptions {
  /** 各 provider 的可覆盖参数（来自聚合 config） */
  providers: ProviderOverrides;
  /** 当前时间戳（传给各 provider 的 buildPollReport） */
  nowMs: number;
  /** 可选：注入 fetcher（测试用）。缺省走真实「读凭证→fetch→buildPollReport」链路 */
  fetchers?: Partial<Record<ProviderKey, ProviderFetcher>>;
}

/** 卡片自上而下的固定顺序 */
const PROVIDER_ORDER: ProviderKey[] = ['claude', 'codex', 'minimax', 'zai'];

/** Claude：读 keychain → fetchUsage → buildPollReport（多 subscription/tier 入参） */
async function defaultClaudeThunk(providers: ProviderOverrides, nowMs: number): Promise<PollReportLike> {
  const credentials = await getCredentials();
  const usage = await fetchUsage(credentials.accessToken);
  return buildClaudeReport(usage, {
    windows: providers.claude.windows,
    nowMs,
    subscription: credentials.subscriptionType,
    tier: credentials.rateLimitTier,
  });
}

/** Codex：读 auth.json → getUsageSnapshot → buildPollReport */
async function defaultCodexThunk(providers: ProviderOverrides, nowMs: number): Promise<PollReportLike> {
  const auth = await loadLocalAuth(providers.codex.authFile);
  const snapshot = await getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    baseUrl: providers.codex.baseUrl,
  });
  return buildCodexReport(snapshot, { windows: providers.codex.windows, nowMs });
}

/** MiniMax：读 .env → fetchMiniMaxQuota → buildPollReport */
async function defaultMiniMaxThunk(providers: ProviderOverrides, nowMs: number): Promise<PollReportLike> {
  const apiKey = await readMiniMaxApiKey({
    envFile: providers.minimax.envFile ?? '',
    apiKeyEnv: providers.minimax.apiKeyEnv ?? '',
  });
  const snapshot = await fetchMiniMaxQuota({ apiKey, apiHost: providers.minimax.apiHost });
  return buildMiniMaxReport(snapshot, { windows: providers.minimax.windows, nowMs });
}

/** Z.ai：读 .env → fetchZaiUsage → buildPollReport */
async function defaultZaiThunk(providers: ProviderOverrides, nowMs: number): Promise<PollReportLike> {
  const apiKey = await readZaiApiKey({
    envFile: providers.zai.envFile ?? '',
    apiKeyEnv: providers.zai.apiKeyEnv ?? '',
  });
  const snapshot = await fetchZaiUsage({ apiKey, apiHost: providers.zai.apiHost });
  return buildZaiReport(snapshot, { windows: providers.zai.windows, nowMs });
}

/**
 * 并行跑 4 个 provider 的「读凭证→fetch→buildPollReport」，单个失败不致命。
 * 用 Promise.allSettled 容错，返回顺序固定为 [claude, codex, minimax, zai]。
 */
export async function collectAllReports(options: CollectOptions): Promise<ProviderResult[]> {
  const tasks: Record<ProviderKey, ProviderFetcher> = {
    claude: options.fetchers?.claude ?? (() => defaultClaudeThunk(options.providers, options.nowMs)),
    codex: options.fetchers?.codex ?? (() => defaultCodexThunk(options.providers, options.nowMs)),
    minimax: options.fetchers?.minimax ?? (() => defaultMiniMaxThunk(options.providers, options.nowMs)),
    zai: options.fetchers?.zai ?? (() => defaultZaiThunk(options.providers, options.nowMs)),
  };

  const settled = await Promise.allSettled(PROVIDER_ORDER.map((key) => tasks[key]()));

  return PROVIDER_ORDER.map((key, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      return { status: 'ok' as const, key, report: r.value };
    }
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return { status: 'error' as const, key, message: reason };
  });
}
