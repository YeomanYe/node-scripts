import { ClaudeAlertWindow } from '../claude-usage/config';
import { CodexAlertWindow } from '../codex-usage/config';
import { MiniMaxAlertWindow } from '../minimax-usage/config';
import { ChannelConfig } from '../shared/notifiers/types';

/** 聚合的三个用量 provider */
export type ProviderKey = 'claude' | 'codex' | 'minimax';

/**
 * 收窄 3 个 provider 各自的 PollReport 到统一字段。
 * 各 provider 的 PollReport 都 extends NotifierMessage 且带 summaryLine，
 * 但 alerts 字段的泛型各异，聚合阶段只关心 title/content/level/summaryLine。
 */
export interface PollReportLike {
  /** 卡片标题 */
  title: string;
  /** lark_md 正文 */
  content: string;
  /** 级别：warn=红 header，info=蓝 header */
  level: 'info' | 'warn';
  /** 单行摘要（供日志） */
  summaryLine: string;
}

/** 单个 provider 获取成功 */
export interface ProviderOk {
  status: 'ok';
  key: ProviderKey;
  report: PollReportLike;
}

/** 单个 provider 获取失败（不影响其余 provider） */
export interface ProviderError {
  status: 'error';
  key: ProviderKey;
  /** 错误信息原文 */
  message: string;
}

/** 单个 provider 的聚合结果 */
export type ProviderResult = ProviderOk | ProviderError;

/** 各 provider 在聚合配置中可覆盖的参数 */
export interface ProviderOverrides {
  claude: { windows: ClaudeAlertWindow[] };
  codex: { windows: CodexAlertWindow[]; authFile?: string; baseUrl?: string };
  minimax: {
    windows: MiniMaxAlertWindow[];
    envFile?: string;
    apiKeyEnv?: string;
    apiHost?: string;
  };
}

/** 聚合脚本配置 */
export interface AggregateConfig {
  poll: { interval_seconds: number };
  /** 复用 claude 通道凭据（与 claude-usage-config.yaml 同一组飞书会话） */
  channels: ChannelConfig[];
  /** 各 provider 可覆盖参数；windows 缺省走各 provider 默认值 */
  providers: ProviderOverrides;
}

/** 聚合后的飞书卡片 */
export interface AggregateCard {
  title: string;
  content: string;
  level: 'info' | 'warn';
  /** 单行摘要（供日志） */
  summaryLine: string;
}
