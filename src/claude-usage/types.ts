/** 用量重置信息 */
export interface ResetInfo {
  /** 使用百分比（0-100） */
  utilization: number;
  /** 重置时间（ISO 8601 格式） */
  resetsAt: string;
}

/** 额外用量信息 */
export interface ExtraUsage {
  /** 是否启用 */
  isEnabled: boolean;
  /** 月度限额（美元） */
  monthlyLimit: number;
  /** 已使用额度（美元） */
  usedCredits: number;
  /** 使用百分比（可能为 null） */
  utilization: number | null;
}

/** 转换后的用量数据 */
export interface UsageData {
  /** 5 小时滑动窗口用量 */
  fiveHour: ResetInfo;
  /** 7 天滑动窗口总用量 */
  sevenDay: ResetInfo;
  /** 7 天 Sonnet 模型用量（可能为 null） */
  sevenDaySonnet: ResetInfo | null;
  /** 7 天 Opus 模型用量（可能为 null） */
  sevenDayOpus: ResetInfo | null;
  /** 7 天 Cowork 用量（可能为 null） */
  sevenDayCowork: ResetInfo | null;
  /** 额外用量信息（可能为 null） */
  extraUsage: ExtraUsage | null;
}

/** API 原始响应中的用量项 */
export interface RawUsageItem {
  utilization: number;
  resets_at: string;
}

/** API 原始响应中的额外用量项 */
export interface RawExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

/** API 原始响应结构 */
export interface RawUsageResponse {
  five_hour: RawUsageItem;
  seven_day: RawUsageItem;
  seven_day_sonnet: RawUsageItem | null;
  seven_day_opus: RawUsageItem | null;
  seven_day_cowork: RawUsageItem | null;
  extra_usage: RawExtraUsage | null;
}

/** OAuth 凭证中的令牌信息 */
interface OAuthTokenInfo {
  accessToken: string;
  subscriptionType?: string;
  rateLimitTier?: string;
}

/** 凭证文件结构 */
export interface CredentialsFile {
  claudeAiOauth: OAuthTokenInfo;
}

/** 解析后的凭证信息 */
export interface Credentials {
  /** OAuth 访问令牌 */
  accessToken: string;
  /** 订阅类型 */
  subscriptionType: string;
  /** 速率限制层级 */
  rateLimitTier: string;
}

/** CLI 命令选项 */
export interface CommandOptions {
  /** 监视模式刷新间隔（秒），false 表示不启用 */
  watch?: number | false;
  /** 是否输出原始 JSON */
  json?: boolean;
}
