/**
 * 纯函数：把任务目标时间吸附到「最近窗口起点」。
 *
 * 决策 (见 docs/superpowers/specs/2026-06-27-llm-window-runner-design.md)：
 *   - 方向不重要，绝对距离最近的胜出
 *   - 并列时取更早 (保守，避免额度被吃光)
 *   - 不限距离阈值
 *   - 候选必须 >= now (无法时间穿越)
 *   - 无候选 → fallback 到 target 本身
 */

export interface WindowAnchor {
  /** 一个已知的窗口起点时间戳 (ms since epoch) */
  startMs: number;
  /** 窗口周期 (ms) */
  durationMs: number;
}

export interface NearestStartResult {
  /** 选定的 fire 时间 (ms) */
  fireAtMs: number;
  /** 原始 target (ms) */
  targetMs: number;
  /** fireAt 与 target 的距离 (ms, 有符号；正=fire 晚于 target) */
  deltaMs: number;
  /** 是否回退到 target (无候选) */
  fallback: boolean;
  /** 全部参与排序的候选 (>= now)，调试用 */
  candidates: number[];
}

/**
 * 在 [fromMs, toMs] 区间内枚举 anchor 周期上所有 (anchor.startMs + k * dur) 时间点。
 * k 可正可负 (前后都枚举)。
 */
export function enumerateStarts(anchor: WindowAnchor, fromMs: number, toMs: number): number[] {
  if (!Number.isFinite(anchor.startMs) || !Number.isFinite(anchor.durationMs)) {
    throw new Error('WindowAnchor.startMs/durationMs 必须是有限数字');
  }
  if (anchor.durationMs <= 0) {
    throw new Error(`WindowAnchor.durationMs 必须 > 0，得到 ${anchor.durationMs}`);
  }
  if (fromMs > toMs) return [];

  // 找到第一个 >= fromMs 的 k
  const kStart = Math.ceil((fromMs - anchor.startMs) / anchor.durationMs);
  const kEnd = Math.floor((toMs - anchor.startMs) / anchor.durationMs);

  const out: number[] = [];
  for (let k = kStart; k <= kEnd; k++) {
    out.push(anchor.startMs + k * anchor.durationMs);
  }
  return out;
}

/**
 * 给一个 "HH:MM" 每日时刻，计算 >= now 的下一次本地时间触发点。
 * 今天的 HH:MM 还没到 → 用今天；已过 → 明天。
 */
export function nextConfiguredTrigger(
  scheduledTimeHHMM: string,
  now: Date = new Date()
): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(scheduledTimeHHMM.trim());
  if (!m) throw new Error(`scheduledTime 必须是 "HH:MM" 格式：${scheduledTimeHHMM}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23) throw new Error(`scheduledTime 小时无效：${scheduledTimeHHMM}`);
  if (mm < 0 || mm > 59) throw new Error(`scheduledTime 分钟无效：${scheduledTimeHHMM}`);

  const candidate = new Date(now);
  candidate.setHours(hh, mm, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/**
 * 在 anchor 周期上找离 target 最近的「>= now」起点。
 *
 * 算法：
 *   1. 枚举区间 [now, target + horizonMs]（再往后无意义，因为再远的候选不会比已选更近）
 *      实际为对称起见取 [now, max(now, target) + horizonMs]，反向不需要再枚举因为
 *      < now 的候选已被过滤掉。
 *   2. 候选过滤 >= now
 *   3. 取 abs(c - target) 最小；并列时取更早
 *   4. 无候选 → fallback 到 target
 */
export function findNearestStart(
  anchor: WindowAnchor,
  targetMs: number,
  nowMs: number,
  horizonMs: number = 48 * 60 * 60 * 1000
): NearestStartResult {
  const fromMs = nowMs;
  const toMs = Math.max(nowMs, targetMs) + horizonMs;
  const candidates = enumerateStarts(anchor, fromMs, toMs);

  if (candidates.length === 0) {
    return {
      fireAtMs: Math.max(targetMs, nowMs),
      targetMs,
      deltaMs: Math.max(targetMs, nowMs) - targetMs,
      fallback: true,
      candidates: [],
    };
  }

  let bestIndex = 0;
  let bestDist = Math.abs(candidates[0]! - targetMs);
  for (let i = 1; i < candidates.length; i++) {
    const dist = Math.abs(candidates[i]! - targetMs);
    if (dist < bestDist || (dist === bestDist && candidates[i]! < candidates[bestIndex]!)) {
      bestIndex = i;
      bestDist = dist;
    }
  }
  const fire = candidates[bestIndex]!;
  return {
    fireAtMs: fire,
    targetMs,
    deltaMs: fire - targetMs,
    fallback: false,
    candidates,
  };
}
