import { UsageData, RawUsageResponse, RawUsageItem } from './types';

/** API 端点 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/** 请求头中的 beta 标识 */
const ANTHROPIC_BETA = 'oauth-2025-04-20';

/**
 * 验证单个用量项结构
 * @param item - 未知数据
 * @returns 是否为有效用量项
 */
export function isValidUsageItem(item: unknown): item is RawUsageItem {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj['utilization'] === 'number' && typeof obj['resets_at'] === 'string';
}

/**
 * 验证 API 响应数据结构
 * @param data - 从 API 返回的未知数据
 * @returns 类型安全的原始响应
 */
export function validateResponse(data: unknown): RawUsageResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('API 响应格式无效：不是对象');
  }

  const obj = data as Record<string, unknown>;

  if (!isValidUsageItem(obj['five_hour'])) {
    throw new Error('API 响应格式无效：five_hour 字段缺失或类型错误');
  }
  if (!isValidUsageItem(obj['seven_day'])) {
    throw new Error('API 响应格式无效：seven_day 字段缺失或类型错误');
  }

  return {
    five_hour: obj['five_hour'] as RawUsageItem,
    seven_day: obj['seven_day'] as RawUsageItem,
    seven_day_sonnet: isValidUsageItem(obj['seven_day_sonnet']) ? obj['seven_day_sonnet'] as RawUsageItem : null,
    seven_day_opus: isValidUsageItem(obj['seven_day_opus']) ? obj['seven_day_opus'] as RawUsageItem : null,
    seven_day_cowork: isValidUsageItem(obj['seven_day_cowork']) ? obj['seven_day_cowork'] as RawUsageItem : null,
    extra_usage: obj['extra_usage'] && typeof obj['extra_usage'] === 'object'
      ? obj['extra_usage'] as RawUsageResponse['extra_usage']
      : null,
  };
}

/**
 * 将 API 原始响应转换为应用内用量数据
 * @param raw - API 原始响应
 * @returns 格式化后的用量数据
 */
export function transformResponse(raw: RawUsageResponse): UsageData {
  const transformItem = (item: RawUsageItem) => ({
    utilization: item.utilization,
    resetsAt: item.resets_at,
  });

  return {
    fiveHour: transformItem(raw.five_hour),
    sevenDay: transformItem(raw.seven_day),
    sevenDaySonnet: raw.seven_day_sonnet ? transformItem(raw.seven_day_sonnet) : null,
    sevenDayOpus: raw.seven_day_opus ? transformItem(raw.seven_day_opus) : null,
    sevenDayCowork: raw.seven_day_cowork ? transformItem(raw.seven_day_cowork) : null,
    extraUsage: raw.extra_usage
      ? {
          isEnabled: raw.extra_usage.is_enabled,
          monthlyLimit: raw.extra_usage.monthly_limit,
          usedCredits: raw.extra_usage.used_credits,
          utilization: raw.extra_usage.utilization,
        }
      : null,
  };
}

/**
 * 从 Anthropic API 获取用量数据
 * @param accessToken - OAuth 访问令牌
 * @returns 用量数据
 */
export async function fetchUsage(accessToken: string): Promise<UsageData> {
  const response = await fetch(USAGE_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': ANTHROPIC_BETA,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `API 请求失败 (${response.status}): ${body || response.statusText}`
    );
  }

  const json: unknown = await response.json();
  const raw = validateResponse(json);
  return transformResponse(raw);
}
