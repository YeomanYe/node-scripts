import { z } from 'zod';
import { CreditsSnapshot, UsageSnapshot, UsageWindow } from './types';

const rateLimitWindowSchema = z
  .object({
    used_percent: z.number(),
    limit_window_seconds: z.number(),
    reset_at: z.number(),
  })
  .nullable()
  .optional();

const rateLimitDetailsSchema = z
  .object({
    primary_window: rateLimitWindowSchema,
    secondary_window: rateLimitWindowSchema,
  })
  .nullable()
  .optional();

const usagePayloadSchema = z.object({
  plan_type: z.string(),
  rate_limit: rateLimitDetailsSchema,
  additional_rate_limits: z
    .array(
      z.object({
        metered_feature: z.string(),
        limit_name: z.string().nullable().optional(),
        rate_limit: rateLimitDetailsSchema,
      })
    )
    .default([]),
  credits: z
    .object({
      has_credits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export interface UsageRequest {
  accessToken: string;
  accountId?: string;
  baseUrl?: string;
  userAgent?: string;
}

export async function getUsageSnapshot(request: UsageRequest): Promise<UsageSnapshot> {
  const baseUrl = normalizeBaseUrl(request.baseUrl ?? 'https://chatgpt.com/backend-api');
  const response = await fetch(`${baseUrl}/wham/usage`, {
    headers: {
      Authorization: `Bearer ${request.accessToken}`,
      'User-Agent': request.userAgent ?? 'codex-usage',
      ...(request.accountId ? { 'ChatGPT-Account-Id': request.accountId } : {}),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Usage request failed with ${response.status}: ${body}`);
  }

  const payload = usagePayloadSchema.parse(JSON.parse(body));
  return {
    planType: payload.plan_type,
    ...(mapWindow(payload.rate_limit?.primary_window)
      ? { primary: mapWindow(payload.rate_limit?.primary_window) }
      : {}),
    ...(mapWindow(payload.rate_limit?.secondary_window)
      ? { secondary: mapWindow(payload.rate_limit?.secondary_window) }
      : {}),
    ...(mapCredits(payload.credits) ? { credits: mapCredits(payload.credits) } : {}),
    additional: payload.additional_rate_limits.map((limit) => {
      const primary = mapWindow(limit.rate_limit?.primary_window);
      const secondary = mapWindow(limit.rate_limit?.secondary_window);
      return {
        limitId: limit.metered_feature,
        limitName: limit.limit_name ?? null,
        ...(primary ? { primary } : {}),
        ...(secondary ? { secondary } : {}),
      };
    }),
    raw: payload,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (
    (trimmed.startsWith('https://chatgpt.com') ||
      trimmed.startsWith('https://chat.openai.com')) &&
    !trimmed.includes('/backend-api')
  ) {
    return `${trimmed}/backend-api`;
  }
  return trimmed;
}

function mapWindow(window?: {
  used_percent: number;
  limit_window_seconds: number;
  reset_at: number;
} | null): UsageWindow | undefined {
  if (!window) {
    return undefined;
  }

  return {
    usedPercent: window.used_percent,
    windowMinutes:
      window.limit_window_seconds > 0 ? Math.ceil(window.limit_window_seconds / 60) : null,
    resetsAt: window.reset_at,
  };
}

function mapCredits(credits?: {
  has_credits: boolean;
  unlimited: boolean;
  balance?: string | null;
} | null): CreditsSnapshot | undefined {
  if (!credits) {
    return undefined;
  }

  return {
    hasCredits: credits.has_credits,
    unlimited: credits.unlimited,
    balance: credits.balance ?? null,
  };
}
