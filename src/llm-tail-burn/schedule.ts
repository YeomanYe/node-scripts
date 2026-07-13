/**
 * 纯函数：窗口尾部 burn 的触发判定。
 *
 * 与 llm-window-runner 的「吸附到窗口起点」相反，这里关注的是「窗口结束」：
 *   - 窗口结束前 leadTime 开始触发
 *   - 窗口结束或剩余额度低于阈值时停止
 */

export interface BurnDecision {
  burn: boolean;
  reason: string;
  /** 当前窗口结束/重置时间 (ms) */
  windowEndMs: number;
  /** 触发时刻 = windowEndMs - leadTime (ms) */
  triggerMs: number;
  /** 剩余额度百分比 (0-100)，未知时为 null */
  remainingPercent: number | null;
}

/**
 * 从 snapshot meta 提取当前窗口结束/重置时间 (ms)。
 * - minimax: meta.currentEndMs (固定窗口的结束时间)
 * - zai/claude/codex: meta.resetsAtMs (rolling 窗口的下个起点 = 当前窗口结束)
 */
export function windowEndMs(meta: Record<string, unknown>): number {
  const currentEndMs = meta['currentEndMs'];
  if (typeof currentEndMs === 'number' && Number.isFinite(currentEndMs)) {
    return currentEndMs;
  }
  const resetsAtMs = meta['resetsAtMs'];
  if (typeof resetsAtMs === 'number' && Number.isFinite(resetsAtMs)) {
    return resetsAtMs;
  }
  throw new Error('snapshot meta 缺少 currentEndMs / resetsAtMs，无法确定窗口结束时间');
}

/**
 * 从 snapshot meta 提取剩余额度百分比 (0-100)。
 * 各 provider 的字段不同，统一归一：
 *   - minimax: remainingPercent
 *   - zai/codex: 100 - usedPercent
 *   - claude: 100 - utilization
 * 未知时返回 null (调用方决定是否允许 burn)。
 */
export function readRemainingPercent(meta: Record<string, unknown>): number | null {
  const remaining = meta['remainingPercent'];
  if (typeof remaining === 'number' && Number.isFinite(remaining)) {
    return remaining;
  }
  const used = meta['usedPercent'];
  if (typeof used === 'number' && Number.isFinite(used)) {
    return 100 - used;
  }
  const utilization = meta['utilization'];
  if (typeof utilization === 'number' && Number.isFinite(utilization)) {
    return 100 - utilization;
  }
  return null;
}

export interface PlanBurnInput {
  meta: Record<string, unknown>;
  /** 离窗口结束多少秒开始触发 */
  leadTimeSeconds: number;
  /** 剩余额度低于此百分比时停止 (0-100) */
  minRemainingPercent: number;
  /** 当前时间 (ms) */
  nowMs: number;
}

/**
 * 判定当前是否应该 burn。
 *
 * 判定顺序：
 *   1. now >= windowEnd  → 不 burn (窗口已结束/已重置)
 *   2. now < trigger     → 不 burn (未到触发时间)
 *   3. remaining < min   → 不 burn (额度不足，避免无意义运行)
 *   4. 否则              → burn
 */
export function planBurn(input: PlanBurnInput): BurnDecision {
  const endMs = windowEndMs(input.meta);
  const triggerMs = endMs - input.leadTimeSeconds * 1000;
  const remainingPercent = readRemainingPercent(input.meta);

  if (input.nowMs >= endMs) {
    return {
      burn: false,
      reason: '窗口已结束/已重置',
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
    };
  }
  if (input.nowMs < triggerMs) {
    const waitSec = Math.round((triggerMs - input.nowMs) / 1000);
    return {
      burn: false,
      reason: `未到触发时间 (还需 ${waitSec}s)`,
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
    };
  }
  if (remainingPercent != null && remainingPercent < input.minRemainingPercent) {
    return {
      burn: false,
      reason: `剩余额度 ${remainingPercent.toFixed(1)}% < 阈值 ${input.minRemainingPercent}%`,
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
    };
  }
  return {
    burn: true,
    reason: remainingPercent != null ? `剩余 ${remainingPercent.toFixed(1)}%` : 'ok (额度未知)',
    windowEndMs: endMs,
    triggerMs,
    remainingPercent,
  };
}
