import { loadLocalAuth } from '../codex-usage/auth';
import { getUsageSnapshot } from '../codex-usage/usage';
import { RunnerConfig, ParallelismResult } from './types';
import { log } from './log';

export function resolveParallelism(usagePercent: number, config: RunnerConfig): number {
  const matchedRule = config.parallelism.rules.find(rule => usagePercent <= rule.max_usage);
  return matchedRule ? matchedRule.concurrency : 0;
}

export async function getParallelism(config: RunnerConfig): Promise<ParallelismResult> {
  try {
    const auth = await loadLocalAuth();
    const usage = await getUsageSnapshot({
      accessToken: auth.accessToken,
      accountId: auth.accountId,
    });

    const usagePercent = usage.primary?.usedPercent ?? usage.secondary?.usedPercent ?? -1;
    const parallelism = usagePercent >= 0 ? resolveParallelism(usagePercent, config) : 1;

    log(`Codex 用量: ${usagePercent >= 0 ? usagePercent.toFixed(1) + '%' : '未知'}，并发度: ${parallelism}`);

    return {
      parallelism,
      usage: usagePercent,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    log(`获取 Codex 用量失败: ${message}，使用最低并发度`);

    return {
      parallelism: 1,
      usage: -1,
    };
  }
}
