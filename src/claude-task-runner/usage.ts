import { getCredentials } from '../claude-usage/credentials';
import { fetchUsage } from '../claude-usage/api';
import { RunnerConfig, ParallelismResult } from './types';
import { log } from './log';

/**
 * 根据用量百分比确定并发度
 * @param usagePercent - 当前用量百分比（0-100）
 * @param config - 运行器配置
 * @returns 对应的并发度
 */
export function resolveParallelism(usagePercent: number, config: RunnerConfig): number {
  const { parallelism } = config;
  const rules = parallelism.rules ?? [];

  if (rules.length > 0) {
    const matchedRule = rules.find(rule => usagePercent < rule.max_usage);
    return matchedRule ? matchedRule.concurrency : parallelism.above_80;
  }

  if (usagePercent < 30) {
    return parallelism.below_30;
  }
  if (usagePercent < 50) {
    return parallelism.below_50;
  }
  if (usagePercent < 80) {
    return parallelism.below_80;
  }
  return parallelism.above_80;
}

/**
 * 获取当前 API 用量并计算并发度
 * @param config - 运行器配置
 * @returns 并发度和当前用量百分比
 */
export async function getParallelism(config: RunnerConfig): Promise<ParallelismResult> {
  try {
    const credentials = await getCredentials();
    const usage = await fetchUsage(credentials.accessToken);

    // 使用 5 小时窗口的用量作为主要参考（API 返回值已经是百分比）
    const usagePercent = usage.fiveHour.utilization;
    const parallelism = resolveParallelism(usagePercent, config);

    log(`API 用量: ${usagePercent.toFixed(1)}%，并发度: ${parallelism}`);

    return {
      parallelism,
      usage: usagePercent,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    log(`获取 API 用量失败: ${message}，使用最低并发度`);

    // 获取失败时使用保守的并发度
    return {
      parallelism: 1,
      usage: -1,
    };
  }
}
