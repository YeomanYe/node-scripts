export interface MiniMaxRawModelRemain {
  start_time?: unknown;
  end_time?: unknown;
  remains_time?: unknown;
  current_interval_total_count?: unknown;
  current_interval_usage_count?: unknown;
  model_name?: unknown;
  current_weekly_total_count?: unknown;
  current_weekly_usage_count?: unknown;
  weekly_start_time?: unknown;
  weekly_end_time?: unknown;
  weekly_remains_time?: unknown;
  current_interval_status?: unknown;
  current_interval_remaining_percent?: unknown;
  current_weekly_status?: unknown;
  current_weekly_remaining_percent?: unknown;
}

export interface MiniMaxRawQuota {
  model_remains?: unknown;
  base_resp?: unknown;
  [key: string]: unknown;
}

export interface MiniMaxQuotaWindow {
  startMs: number | null;
  endMs: number | null;
  remainsMs: number | null;
  totalCount: number | null;
  usageCount: number | null;
  remainingPercent: number | null;
  usedPercent: number | null;
  status: number | null;
}

export interface MiniMaxModelQuota {
  modelName: string;
  interval: MiniMaxQuotaWindow;
  weekly: MiniMaxQuotaWindow;
}

export interface MiniMaxQuotaSnapshot {
  models: MiniMaxModelQuota[];
  raw: MiniMaxRawQuota;
}
