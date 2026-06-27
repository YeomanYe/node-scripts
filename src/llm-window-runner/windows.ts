/**
 * 把 4 个 provider 各自的 snapshot 归一为统一的 WindowAnchor (startMs + durationMs)。
 */

import { fetchUsage } from '../claude-usage/api';
import { getCredentials } from '../claude-usage/credentials';
import { UsageData } from '../claude-usage/types';
import { loadLocalAuth } from '../codex-usage/auth';
import { getUsageSnapshot } from '../codex-usage/usage';
import { UsageSnapshot as CodexSnapshot } from '../codex-usage/types';
import { fetchMiniMaxQuota } from '../minimax-usage/quota';
import { MiniMaxQuotaSnapshot } from '../minimax-usage/types';
import { DEFAULT_API_KEY_ENV as MM_DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE as MM_DEFAULT_ENV_FILE, readMiniMaxApiKey } from '../minimax-usage/env';
import { fetchZaiUsage } from '../zai-usage/quota';
import { ZaiUsageSnapshot } from '../zai-usage/types';
import { DEFAULT_API_KEY_ENV as Z_DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE as Z_DEFAULT_ENV_FILE, readZaiApiKey } from '../zai-usage/env';
import { ClaudeProvider, CodexProvider, MinimaxProvider, WindowProvider, ZaiProvider } from './config';
import { WindowAnchor } from './schedule';

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

export interface WindowAnchorResult {
  anchor: WindowAnchor;
  /** 拉 snapshot 的额外信息，用于 list/next 命令呈现 */
  meta: Record<string, unknown>;
}

export interface ResolveAnchorOptions {
  /** 全局 fallback：dotenv 文件 (zai/minimax) */
  envFile?: string;
  /** 全局 fallback：zai 的 env 变量名 */
  zaiApiKeyEnv?: string;
  /** 全局 fallback：minimax 的 env 变量名 */
  minimaxApiKeyEnv?: string;
  /** codex auth 文件路径 */
  codexAuthFile?: string;
}

export async function resolveWindowAnchor(
  provider: WindowProvider,
  options: ResolveAnchorOptions = {}
): Promise<WindowAnchorResult> {
  switch (provider.type) {
    case 'minimax':
      return resolveMinimaxAnchor(provider, options);
    case 'zai':
      return resolveZaiAnchor(provider, options);
    case 'claude':
      return resolveClaudeAnchor(provider);
    case 'codex':
      return resolveCodexAnchor(provider, options);
  }
}

async function resolveMinimaxAnchor(
  provider: MinimaxProvider,
  options: ResolveAnchorOptions
): Promise<WindowAnchorResult> {
  const apiKey = provider.apiKey?.trim()
    ? provider.apiKey.trim()
    : await readMiniMaxApiKey({
        envFile: provider.envFile ?? options.envFile ?? MM_DEFAULT_ENV_FILE,
        apiKeyEnv: provider.apiKeyEnv ?? options.minimaxApiKeyEnv ?? MM_DEFAULT_API_KEY_ENV,
      });
  const snapshot = await fetchMiniMaxQuota({ apiKey });
  return anchorFromMinimax(snapshot, provider);
}

export function anchorFromMinimax(
  snapshot: MiniMaxQuotaSnapshot,
  provider: MinimaxProvider
): WindowAnchorResult {
  if (snapshot.models.length === 0) {
    throw new Error('minimax snapshot 为空，无可用 model');
  }
  const model = provider.model
    ? snapshot.models.find((m) => m.modelName === provider.model)
    : snapshot.models[0];
  if (!model) {
    throw new Error(`minimax snapshot 未包含 model=${provider.model}`);
  }
  const window = provider.window === 'weekly' ? model.weekly : model.interval;
  if (window.startMs == null || window.endMs == null) {
    throw new Error(`minimax ${model.modelName}.${provider.window} 缺少 startMs/endMs`);
  }
  const durationMs = window.endMs - window.startMs;
  if (durationMs <= 0) {
    throw new Error(`minimax ${model.modelName}.${provider.window} 的窗口长度异常：${durationMs}ms`);
  }
  return {
    anchor: { startMs: window.startMs, durationMs },
    meta: {
      providerType: 'minimax',
      modelName: model.modelName,
      window: provider.window,
      currentStartMs: window.startMs,
      currentEndMs: window.endMs,
      remainingPercent: window.remainingPercent,
    },
  };
}

async function resolveZaiAnchor(
  provider: ZaiProvider,
  options: ResolveAnchorOptions
): Promise<WindowAnchorResult> {
  const apiKey = provider.apiKey?.trim()
    ? provider.apiKey.trim()
    : await readZaiApiKey({
        envFile: provider.envFile ?? options.envFile ?? Z_DEFAULT_ENV_FILE,
        apiKeyEnv: provider.apiKeyEnv ?? options.zaiApiKeyEnv ?? Z_DEFAULT_API_KEY_ENV,
      });
  const snapshot = await fetchZaiUsage({ apiKey });
  return anchorFromZai(snapshot, provider);
}

export function anchorFromZai(snapshot: ZaiUsageSnapshot, provider: ZaiProvider): WindowAnchorResult {
  const window = provider.window === 'secondary' ? snapshot.secondary : snapshot.primary;
  if (!window) throw new Error(`zai snapshot 缺少 ${provider.window} window`);
  if (window.resetsAtMs == null) throw new Error(`zai ${provider.window} 缺少 resetsAtMs`);
  if (window.windowMinutes == null || window.windowMinutes <= 0) {
    throw new Error(`zai ${provider.window} 缺少有效 windowMinutes`);
  }
  return {
    anchor: { startMs: window.resetsAtMs, durationMs: window.windowMinutes * 60 * 1000 },
    meta: {
      providerType: 'zai',
      window: provider.window,
      resetsAtMs: window.resetsAtMs,
      windowMinutes: window.windowMinutes,
      usedPercent: window.usedPercent,
    },
  };
}

async function resolveClaudeAnchor(provider: ClaudeProvider): Promise<WindowAnchorResult> {
  const creds = await getCredentials();
  const snapshot = await fetchUsage(creds.accessToken);
  return anchorFromClaude(snapshot, provider);
}

export function anchorFromClaude(snapshot: UsageData, provider: ClaudeProvider): WindowAnchorResult {
  const window = provider.window === 'sevenDay' ? snapshot.sevenDay : snapshot.fiveHour;
  const startMs = Date.parse(window.resetsAt);
  if (!Number.isFinite(startMs)) {
    throw new Error(`claude ${provider.window}.resetsAt 解析失败：${window.resetsAt}`);
  }
  const durationMs = provider.window === 'sevenDay' ? SEVEN_DAY_MS : FIVE_HOUR_MS;
  return {
    anchor: { startMs, durationMs },
    meta: {
      providerType: 'claude',
      window: provider.window,
      resetsAtMs: startMs,
      utilization: window.utilization,
    },
  };
}

async function resolveCodexAnchor(
  provider: CodexProvider,
  _options: ResolveAnchorOptions
): Promise<WindowAnchorResult> {
  const auth = await loadLocalAuth();
  const snapshot = await getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
  });
  return anchorFromCodex(snapshot, provider);
}

export function anchorFromCodex(snapshot: CodexSnapshot, provider: CodexProvider): WindowAnchorResult {
  let window: { resetsAt: number | null; windowMinutes: number | null; usedPercent: number } | undefined;
  if (provider.limitId) {
    const extra = snapshot.additional.find((a) => a.limitId === provider.limitId);
    if (!extra) throw new Error(`codex snapshot 未包含 limitId=${provider.limitId}`);
    window = provider.window === 'secondary' ? extra.secondary : extra.primary;
  } else {
    window = provider.window === 'secondary' ? snapshot.secondary : snapshot.primary;
  }
  if (!window) throw new Error(`codex snapshot 缺少 ${provider.window} window`);
  if (window.resetsAt == null) throw new Error(`codex ${provider.window} 缺少 resetsAt`);
  if (window.windowMinutes == null || window.windowMinutes <= 0) {
    throw new Error(`codex ${provider.window} 缺少有效 windowMinutes`);
  }
  // codex 的 resetsAt 是 epoch 秒
  const startMs = window.resetsAt * 1000;
  return {
    anchor: { startMs, durationMs: window.windowMinutes * 60 * 1000 },
    meta: {
      providerType: 'codex',
      window: provider.window,
      limitId: provider.limitId ?? null,
      resetsAtMs: startMs,
      windowMinutes: window.windowMinutes,
      usedPercent: window.usedPercent,
    },
  };
}
