import {
  ZaiLimitType,
  ZaiLimitWindow,
  ZaiRawLimit,
  ZaiRawQuotaResponse,
  ZaiUsageDetail,
  ZaiUsageSnapshot,
} from './types';

export const DEFAULT_ZAI_HOST = 'https://api.z.ai';
const QUOTA_PATH = 'api/monitor/usage/quota/limit';

export interface FetchZaiUsageOptions {
  apiKey: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * unit code → 分钟数 + 人类可读标签（不含 "window" 后缀）。
 *
 * 注意：Z.ai 的 unit=3 在 CodexBar 样例响应里固定搭配 number=5（5 小时窗口），
 * 因此 minutes 与 label 已把 number 语义烘焙进去（minutes=300，label='5 hour'）。
 * 这是与 `windowMinutes`/`windowLabel` 协作的结果：调用方不再额外乘 number。
 */
export function parseZaiLimitUnit(unit: unknown): { minutes: number | null; label: string | null } {
  const code = asNumber(unit);
  if (code === null) return { minutes: null, label: null };
  switch (code) {
    case 1: return { minutes: 1, label: 'minute' };
    case 3: return { minutes: 300, label: '5 hour' };
    case 5: return { minutes: 1440, label: '1 day' };
    case 6: return { minutes: 10080, label: '1 week' };
    default: return { minutes: null, label: null };
  }
}

function windowMinutes(type: ZaiLimitType, unit: unknown): number | null {
  if (type !== 'TOKENS_LIMIT') return null;
  const { minutes } = parseZaiLimitUnit(unit);
  return minutes;
}

function windowLabel(type: ZaiLimitType, unit: unknown): string | null {
  const { label } = parseZaiLimitUnit(unit);
  if (label === null) return null;
  const base = `${label} window`;
  // TIME_LIMIT 且 unit=5(number=1) 按 CodexBar 显示为 Monthly
  return type === 'TIME_LIMIT' && asNumber(unit) === 5 ? 'Monthly' : base;
}

function computeUsedPercent(limit: ZaiRawLimit): number | null {
  const usage = asNumber(limit.usage);
  const remaining = asNumber(limit.remaining);
  const currentValue = asNumber(limit.currentValue);
  const percentage = asNumber(limit.percentage);

  if (usage !== null && usage > 0) {
    let usedRaw: number | null = null;
    if (remaining !== null) {
      const fromRemaining = usage - remaining;
      usedRaw = currentValue !== null ? Math.max(fromRemaining, currentValue) : fromRemaining;
    } else if (currentValue !== null) {
      usedRaw = currentValue;
    }
    if (usedRaw !== null) {
      const used = Math.max(0, Math.min(usage, usedRaw));
      return Math.min(100, Math.max(0, (used / usage) * 100));
    }
  }
  return percentage;
}

function normalizeUsageDetails(raw: unknown): ZaiUsageDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ZaiUsageDetail | null => {
      if (typeof item !== 'object' || item === null) return null;
      const obj = item as Record<string, unknown>;
      const modelCode = typeof obj.modelCode === 'string' ? obj.modelCode : null;
      const usage = asNumber(obj.usage);
      if (modelCode === null || usage === null) return null;
      return { modelCode, usage };
    })
    .filter((x): x is ZaiUsageDetail => x !== null);
}

function normalizeWindow(limit: ZaiRawLimit): ZaiLimitWindow | null {
  const type = typeof limit.type === 'string' && (limit.type === 'TOKENS_LIMIT' || limit.type === 'TIME_LIMIT')
    ? (limit.type as ZaiLimitType)
    : null;
  if (type === null) return null;
  return {
    type,
    windowMinutes: windowMinutes(type, limit.unit),
    windowLabel: windowLabel(type, limit.unit),
    usage: asNumber(limit.usage),
    remaining: asNumber(limit.remaining),
    currentValue: asNumber(limit.currentValue),
    usedPercent: computeUsedPercent(limit),
    resetsAtMs: asNumber(limit.nextResetTime),
    usageDetails: normalizeUsageDetails(limit.usageDetails),
  };
}

export function normalizeZaiUsage(raw: ZaiRawQuotaResponse): ZaiUsageSnapshot {
  const code = asNumber(raw.code);
  const success = raw.success === true;
  if (!success || code !== 200) {
    throw new Error(typeof raw.msg === 'string' && raw.msg ? raw.msg : `Z.ai 用量查询失败 (code=${code ?? '?'})`);
  }
  const data = raw.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Missing data');
  }
  const limitsRaw = Array.isArray(data.limits) ? (data.limits as ZaiRawLimit[]) : [];
  const windows = limitsRaw.map(normalizeWindow).filter((w): w is ZaiLimitWindow => w !== null);

  const tokens = windows.filter((w) => w.type === 'TOKENS_LIMIT');
  const times = windows.filter((w) => w.type === 'TIME_LIMIT');

  let primary: ZaiLimitWindow | null = null;
  let secondary: ZaiLimitWindow | null = null;

  if (tokens.length >= 2) {
    const sorted = [...tokens].sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
    secondary = sorted[0] ?? null; // 最短 → secondary
    primary = sorted[sorted.length - 1] ?? null; // 最长 → primary
  } else if (tokens.length === 1) {
    primary = tokens[0] ?? null;
    if (times.length > 0) secondary = times[0] ?? null;
  } else if (times.length > 0) {
    primary = times[0] ?? null;
  }

  const planName = typeof data.planName === 'string' && data.planName.trim().length > 0
    ? data.planName.trim()
    : null;

  return { planName, primary, secondary, raw };
}

function buildQuotaUrl(apiHost: string): string {
  const base = apiHost.replace(/\/+$/, '');
  return `${base}/${QUOTA_PATH}`;
}

export async function fetchZaiUsage(options: FetchZaiUsageOptions): Promise<ZaiUsageSnapshot> {
  const doFetch = options.fetchImpl ?? fetch;
  const host = options.apiHost ?? DEFAULT_ZAI_HOST;
  const response = await doFetch(buildQuotaUrl(host), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Z.ai 用量查询失败 (HTTP ${response.status}): ${body || 'unknown error'}`);
  }
  if (body.trim().length === 0) {
    throw new Error('Z.ai 返回空响应 (HTTP 200)，请检查 API 区域与 token');
  }
  return normalizeZaiUsage(JSON.parse(body) as ZaiRawQuotaResponse);
}
