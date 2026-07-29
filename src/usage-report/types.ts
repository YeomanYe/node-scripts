import { ChannelConfig } from '../shared/notifiers/types';

/** CodexBar 配置中启用的 provider id */
export type ProviderKey = string;

/**
 * CodexBar 各 provider 的报告统一收窄到聚合阶段需要的字段。
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

/** 聚合脚本配置 */
export interface AggregateConfig {
  poll: { interval_seconds: number };
  /** 复用 claude 通道凭据（与 claude-usage-config.yaml 同一组飞书会话） */
  channels: ChannelConfig[];
}

/** 聚合后的飞书卡片 */
export interface AggregateCard {
  title: string;
  content: string;
  level: 'info' | 'warn';
  /** 单行摘要（供日志） */
  summaryLine: string;
}
