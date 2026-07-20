/**
 * 纯函数：单个 agent 的 burn-ready 判定 + 多 agent 组合。
 *
 * 三类判定模式：
 *   - tail:        minimax 风格，窗口尾部 leadTime 触发 + 额度阈值
 *   - rate:        codex rolling 窗口，"剩余% / 剩余小时 > ratePerHour" 时认为有 tail
 *   - projection:  claude/zai 双窗口（5h+7d），投影"每个剩余 5h 都跑满能否消耗完 7d"
 *
 * 多 agent 组合：
 *   - match=all: 全部 ready 才 fire
 *   - match=any: 任一 ready 即 fire
 */

import { AgentKind, MatchMode } from './config';

/** 短窗口 (5h) 长度，用于 projection 的"剩余时间内能开几个完整短窗口"计算 */
export const SHORT_WINDOW_MS = 5 * 60 * 60 * 1000;

export interface AgentDecision {
  ready: boolean;
  reason: string;
  kind: AgentKind;
  /** 该 agent 关心的窗口结束时间 (ms)，用于多 agent 窗口跟踪 */
  windowEndMs: number;
  /** tail 模式 trigger = windowEnd - leadTime；其他模式为 null */
  triggerMs: number | null;
  /** 剩余额度百分比 (0-100)，未知时为 null */
  remainingPercent: number | null;
  /** 原始 snapshot meta (调试用) */
  meta: Record<string, unknown>;
}

export interface CombinedBurnDecision {
  burn: boolean;
  reason: string;
  match: MatchMode;
  /** 用于窗口切换跟踪：所有 agent 中最早的 windowEndMs */
  windowEndMs: number;
  /** tail 模式才有意义的触发时间；多 agent 时取最大值（最严苛） */
  triggerMs: number | null;
  /** 展示用：首个 ready agent 的 remainingPercent */
  remainingPercent: number | null;
  agents: AgentDecision[];
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
 * 从 snapshot meta 提取剩余额度百分比 (0-100)。各 provider 字段不同，统一归一：
 *   - minimax: remainingPercent
 *   - zai/codex: 100 - usedPercent
 *   - claude: 100 - utilization
 * 未知时返回 null。
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

// ─── tail ──────────────────────────────────────────────────────────────

export interface PlanTailInput {
  meta: Record<string, unknown>;
  leadTimeSeconds: number;
  minRemainingPercent: number;
  nowMs: number;
}

/**
 * minimax 风格尾部判定。
 * ready 顺序：
 *   1. now >= windowEnd  → false (窗口已结束)
 *   2. now < windowEnd - leadTime → false (未到触发时间)
 *   3. remaining < minRemaining → false (额度不足)
 *   4. 否则 → true
 */
export function planTail(input: PlanTailInput): AgentDecision {
  const endMs = windowEndMs(input.meta);
  const triggerMs = endMs - input.leadTimeSeconds * 1000;
  const remainingPercent = readRemainingPercent(input.meta);
  const kind: AgentKind = 'tail';

  if (input.nowMs >= endMs) {
    return {
      kind,
      ready: false,
      reason: '窗口已结束/已重置',
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
      meta: input.meta,
    };
  }
  if (input.nowMs < triggerMs) {
    const waitSec = Math.round((triggerMs - input.nowMs) / 1000);
    return {
      kind,
      ready: false,
      reason: `未到触发时间 (还需 ${waitSec}s)`,
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
      meta: input.meta,
    };
  }
  if (remainingPercent != null && remainingPercent < input.minRemainingPercent) {
    return {
      kind,
      ready: false,
      reason: `剩余 ${remainingPercent.toFixed(1)}% < 阈值 ${input.minRemainingPercent}%`,
      windowEndMs: endMs,
      triggerMs,
      remainingPercent,
      meta: input.meta,
    };
  }
  return {
    kind,
    ready: true,
    reason: remainingPercent != null ? `剩余 ${remainingPercent.toFixed(1)}%` : 'ok (额度未知)',
    windowEndMs: endMs,
    triggerMs,
    remainingPercent,
    meta: input.meta,
  };
}

// ─── rate ──────────────────────────────────────────────────────────────

export interface PlanRateInput {
  meta: Record<string, unknown>;
  ratePerHour: number;
  nowMs: number;
}

/**
 * codex 风格速率判定。
 * 设 actualRate = remainingPercent / remainingHours；当 actualRate > ratePerHour
 * (即按当前剩余看，正常用不完，有 tail 可烧) 时 ready=true。
 *
 * 边界：
 *   - now >= windowEnd → false (窗口已结束)
 *   - remainingPercent 未知 → false (无法做速率判定)
 *   - remainingHours <= 0 → 视作 actualRate=Infinity (一定 ready，前提是 remaining>0)
 */
export function planRate(input: PlanRateInput): AgentDecision {
  const endMs = windowEndMs(input.meta);
  const remainingPercent = readRemainingPercent(input.meta);
  const kind: AgentKind = 'rate';

  if (input.nowMs >= endMs) {
    return {
      kind,
      ready: false,
      reason: '窗口已结束/已重置',
      windowEndMs: endMs,
      triggerMs: null,
      remainingPercent,
      meta: input.meta,
    };
  }
  if (remainingPercent == null) {
    return {
      kind,
      ready: false,
      reason: '剩余额度未知，无法做速率判定',
      windowEndMs: endMs,
      triggerMs: null,
      remainingPercent,
      meta: input.meta,
    };
  }

  const remainingHours = Math.max((endMs - input.nowMs) / 3_600_000, 0);
  const actualRate = remainingHours > 0 ? remainingPercent / remainingHours : Infinity;

  if (actualRate <= input.ratePerHour) {
    return {
      kind,
      ready: false,
      reason: `速率 ${actualRate.toFixed(2)}%/h ≤ ${input.ratePerHour}/h，无 tail`,
      windowEndMs: endMs,
      triggerMs: null,
      remainingPercent,
      meta: input.meta,
    };
  }
  return {
    kind,
    ready: true,
    reason: `速率 ${actualRate.toFixed(2)}%/h > ${input.ratePerHour}/h (剩 ${remainingPercent.toFixed(1)}% / ${remainingHours.toFixed(1)}h)`,
    windowEndMs: endMs,
    triggerMs: null,
    remainingPercent,
    meta: input.meta,
  };
}

// ─── projection ────────────────────────────────────────────────────────

export interface PlanProjectionInput {
  shortMeta: Record<string, unknown>;
  longMeta: Record<string, unknown>;
  /** 一个完整短窗口跑满相当于消耗长窗口的多少 % (例如 claude=8, zai=20) */
  shortWindowConsumePercent: number;
  nowMs: number;
  /** 短窗口长度 ms，默认 5h；可配用于特殊窗口 */
  shortWindowMs?: number;
}

/**
 * claude/zai 双窗口投影判定。
 *
 * 含义："持续 max 满载短窗口直到长窗口结束，能否消耗完长窗口剩余额度？"
 *   设：
 *     K   = shortWindowConsumePercent (一个满短窗消耗长窗的 %)
 *     R5h = 短窗剩余 % (0-100)
 *     t5h = 短窗剩余时间 (ms)
 *     t7d = 长窗剩余时间 (ms)
 *     n   = floor((t7d - t5h) / shortWindowMs)  →  短窗结束后还能开几个完整短窗
 *   投影消耗 = K × (R5h/100 + n)
 *
 *   若投影消耗 < R7d (长窗剩余 %)，说明按最大负荷也烧不完 → ready=true (有 tail)
 *
 * 边界：
 *   - now >= longEnd → false (长窗已结束)
 *   - R5h 或 R7d 未知 → false (无法投影)
 */
export function planProjection(input: PlanProjectionInput): AgentDecision {
  const shortEnd = windowEndMs(input.shortMeta);
  const longEnd = windowEndMs(input.longMeta);
  const R5h = readRemainingPercent(input.shortMeta);
  const R7d = readRemainingPercent(input.longMeta);
  const shortMs = input.shortWindowMs ?? SHORT_WINDOW_MS;
  const kind: AgentKind = 'projection';

  if (input.nowMs >= longEnd) {
    return {
      kind,
      ready: false,
      reason: '长窗口已结束',
      windowEndMs: longEnd,
      triggerMs: null,
      remainingPercent: R7d,
      meta: input.shortMeta,
    };
  }
  if (R5h == null || R7d == null) {
    return {
      kind,
      ready: false,
      reason: '短窗或长窗剩余额度未知',
      windowEndMs: shortEnd,
      triggerMs: null,
      remainingPercent: R5h ?? R7d,
      meta: input.shortMeta,
    };
  }

  const t5h = Math.max(shortEnd - input.nowMs, 0);
  const t7d = Math.max(longEnd - input.nowMs, 0);
  const fullShortWindows = Math.max(Math.floor((t7d - t5h) / shortMs), 0);
  const projectedConsume = input.shortWindowConsumePercent * (R5h / 100 + fullShortWindows);

  if (projectedConsume >= R7d) {
    return {
      kind,
      ready: false,
      reason: `投影消耗 ${projectedConsume.toFixed(1)}% ≥ 长窗剩余 ${R7d.toFixed(1)}% (n=${fullShortWindows}, R5h=${R5h.toFixed(1)}%)`,
      windowEndMs: shortEnd,
      triggerMs: null,
      remainingPercent: R5h,
      meta: input.shortMeta,
    };
  }
  return {
    kind,
    ready: true,
    reason: `投影消耗 ${projectedConsume.toFixed(1)}% < 长窗剩余 ${R7d.toFixed(1)}% (n=${fullShortWindows}, R5h=${R5h.toFixed(1)}%, K=${input.shortWindowConsumePercent}%)`,
    windowEndMs: shortEnd,
    triggerMs: null,
    remainingPercent: R5h,
    meta: input.shortMeta,
  };
}

// ─── combine ───────────────────────────────────────────────────────────

export function combineDecisions(agents: AgentDecision[], match: MatchMode): CombinedBurnDecision {
  if (agents.length === 0) {
    throw new Error('combineDecisions: 至少需要一个 agent 决策');
  }
  const readyCount = agents.filter((a) => a.ready).length;
  const burn = match === 'all' ? readyCount === agents.length : readyCount > 0;

  const windowEndMs = Math.min(...agents.map((a) => a.windowEndMs));
  const triggerValues = agents.map((a) => a.triggerMs).filter((x): x is number => x != null);
  const triggerMs = triggerValues.length > 0 ? Math.max(...triggerValues) : null;
  const firstReady = agents.find((a) => a.ready);
  const remainingPercent = firstReady?.remainingPercent ?? agents[0]!.remainingPercent ?? null;

  const detail = agents
    .map((a, i) => `agent[${i}]=${a.kind}${a.ready ? '+' : '-'}(${a.reason})`)
    .join('; ');
  const summary = match === 'all'
    ? `${readyCount}/${agents.length} ready`
    : `${readyCount}/${agents.length} ready`;

  return {
    burn,
    reason: `${summary} | ${detail}`,
    match,
    windowEndMs,
    triggerMs,
    remainingPercent,
    agents,
  };
}
