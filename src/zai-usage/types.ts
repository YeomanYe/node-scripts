export type ZaiLimitType = 'TOKENS_LIMIT' | 'TIME_LIMIT';

/** 原始 limits[] 单项（字段全部按 unknown 容错，由 quota.ts 归一化） */
export interface ZaiRawLimit {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
  usage?: unknown;
  currentValue?: unknown;
  remaining?: unknown;
  percentage?: unknown;
  nextResetTime?: unknown;
  usageDetails?: unknown;
  [key: string]: unknown;
}

export interface ZaiRawQuotaResponse {
  code?: unknown;
  msg?: unknown;
  success?: unknown;
  data?: { limits?: unknown; planName?: unknown; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface ZaiUsageDetail {
  modelCode: string;
  usage: number;
}

/** 归一化后的单个用量窗口 */
export interface ZaiLimitWindow {
  type: ZaiLimitType;
  windowMinutes: number | null;
  windowLabel: string | null;
  usage: number | null;
  remaining: number | null;
  currentValue: number | null;
  usedPercent: number | null;
  resetsAtMs: number | null;
  usageDetails: ZaiUsageDetail[];
}

/** 归一化后的智谱用量快照 */
export interface ZaiUsageSnapshot {
  planName: string | null;
  primary: ZaiLimitWindow | null;
  secondary: ZaiLimitWindow | null;
  raw: ZaiRawQuotaResponse;
}
