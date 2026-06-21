import {
  MiniMaxModelQuota,
  MiniMaxQuotaSnapshot,
  MiniMaxQuotaWindow,
  MiniMaxRawModelRemain,
  MiniMaxRawQuota,
} from './types';

export const DEFAULT_MINIMAX_HOST = 'https://api.minimaxi.com';
const TOKEN_PLAN_PATH = 'v1/token_plan/remains';
const CODING_PLAN_PATH = 'v1/api/openplatform/coding_plan/remains';

export interface FetchQuotaOptions {
  apiKey: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function percentUsed(remainingPercent: number | null): number | null {
  if (remainingPercent === null) return null;
  return Math.max(0, Math.min(100, 100 - remainingPercent));
}

function buildWindow(options: {
  startMs: unknown;
  endMs: unknown;
  remainsMs: unknown;
  totalCount: unknown;
  usageCount: unknown;
  remainingPercent: unknown;
  status: unknown;
}): MiniMaxQuotaWindow {
  const remainingPercent = asNumber(options.remainingPercent);
  return {
    startMs: asNumber(options.startMs),
    endMs: asNumber(options.endMs),
    remainsMs: asNumber(options.remainsMs),
    totalCount: asNumber(options.totalCount),
    usageCount: asNumber(options.usageCount),
    remainingPercent,
    usedPercent: percentUsed(remainingPercent),
    status: asNumber(options.status),
  };
}

function normalizeModel(raw: MiniMaxRawModelRemain): MiniMaxModelQuota {
  const modelName =
    typeof raw.model_name === 'string' && raw.model_name.length > 0
      ? raw.model_name
      : 'unknown';
  return {
    modelName,
    interval: buildWindow({
      startMs: raw.start_time,
      endMs: raw.end_time,
      remainsMs: raw.remains_time,
      totalCount: raw.current_interval_total_count,
      usageCount: raw.current_interval_usage_count,
      remainingPercent: raw.current_interval_remaining_percent,
      status: raw.current_interval_status,
    }),
    weekly: buildWindow({
      startMs: raw.weekly_start_time,
      endMs: raw.weekly_end_time,
      remainsMs: raw.weekly_remains_time,
      totalCount: raw.current_weekly_total_count,
      usageCount: raw.current_weekly_usage_count,
      remainingPercent: raw.current_weekly_remaining_percent,
      status: raw.current_weekly_status,
    }),
  };
}

/** 兼容两种包装：HTTP 的 { data: { model_remains } } 与旧 mmx 的顶层 model_remains */
export function extractJsonPayload(output: string): MiniMaxRawQuota {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('minimax 响应未返回 JSON');
  }
  return JSON.parse(output.slice(start, end + 1)) as MiniMaxRawQuota;
}

export function normalizeQuota(raw: MiniMaxRawQuota): MiniMaxQuotaSnapshot {
  const dataEnvelope = (raw as { data?: { model_remains?: unknown; plan_name?: unknown } | null }).data;
  const remainsSource = Array.isArray((dataEnvelope as { model_remains?: unknown } | null)?.model_remains)
    ? (dataEnvelope as { model_remains: unknown[] }).model_remains
    : Array.isArray((raw as { model_remains?: unknown }).model_remains)
      ? (raw as { model_remains: unknown[] }).model_remains
      : [];

  // base_resp 状态校验（HTTP 包装在顶层或 data 内）
  const baseResp = (raw as { base_resp?: { status_code?: unknown; status_msg?: unknown } }).base_resp
    ?? (dataEnvelope as { base_resp?: { status_code?: unknown; status_msg?: unknown } } | null)?.base_resp;
  const statusCode = asNumber(baseResp?.status_code);
  if (statusCode !== null && statusCode !== 0) {
    const msg = typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : `status_code ${statusCode}`;
    const lower = msg.toLowerCase();
    if (statusCode === 1004 || lower.includes('cookie') || lower.includes('log in') || lower.includes('login')) {
      throw new Error(`minimax 凭据无效: ${msg}`);
    }
    throw new Error(`minimax 用量查询失败: ${msg}`);
  }

  if (remainsSource.length === 0) throw new Error('minimax 未返回 model_remains 数据');

  const models = remainsSource.map((item) => normalizeModel(item as MiniMaxRawModelRemain));
  const planName =
    typeof (dataEnvelope as { plan_name?: unknown } | null)?.plan_name === 'string'
      ? ((dataEnvelope as { plan_name: string }).plan_name).trim() || null
      : null;

  return { models, planName, raw };
}

interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

async function fetchOnce(
  doFetch: typeof fetch,
  url: string,
  apiKey: string
): Promise<MiniMaxQuotaSnapshot> {
  const response = (await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  })) as HttpResponse;
  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`minimax 凭据无效 (HTTP ${response.status})`);
    }
    throw new Error(`minimax 用量查询失败 (HTTP ${response.status}): ${body || 'unknown error'}`);
  }
  return normalizeQuota(extractJsonPayload(body));
}

/** 是否应 fallback 到旧端点（照搬 CodexBar shouldTryLegacyAPIEndpoint） */
function shouldTryLegacy(after: Error): boolean {
  const msg = after.message.toLowerCase();
  if (msg.includes('凭据')) return false;
  return msg.includes('http 404') || msg.includes('http 405') || msg.includes('未返回');
}

export async function fetchMiniMaxQuota(options: FetchQuotaOptions): Promise<MiniMaxQuotaSnapshot> {
  const doFetch = options.fetchImpl ?? fetch;
  const host = (options.apiHost ?? DEFAULT_MINIMAX_HOST).replace(/\/+$/, '');
  try {
    return await fetchOnce(doFetch, `${host}/${TOKEN_PLAN_PATH}`, options.apiKey);
  } catch (error) {
    if (!(error instanceof Error) || !shouldTryLegacy(error)) throw error;
    return await fetchOnce(doFetch, `${host}/${CODING_PLAN_PATH}`, options.apiKey);
  }
}
