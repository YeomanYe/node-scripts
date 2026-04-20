/** 单次线性预算检查输入 */
export interface ProratedInput {
  /** 当前用量百分比（0-100） */
  utilization: number;
  /** 窗口重置的绝对毫秒时间戳 */
  resetsAtMs: number;
  /** 窗口总长度（毫秒） */
  windowMs: number;
  /** 当前毫秒时间戳（便于测试注入），默认 Date.now() */
  nowMs?: number;
}

/** 单次线性预算检查结果 */
export interface ProratedResult {
  /** 当前时点的"线性预算"百分比 = elapsed / windowMs × 100，已截断到 [0, 100] */
  expected: number;
  /** 是否超出线性预算 */
  breached: boolean;
  /** utilization - expected（百分点） */
  overBy: number;
}

/**
 * 线性预算告警判定：当前用量是否超过"已过去时间占窗口比例"
 * @throws 当 windowMs <= 0 时
 */
export function checkProrated(input: ProratedInput): ProratedResult {
  if (!Number.isFinite(input.windowMs) || input.windowMs <= 0) {
    throw new Error(`checkProrated: windowMs must be > 0, got ${input.windowMs}`);
  }

  const now = input.nowMs ?? Date.now();
  const elapsed = input.windowMs - (input.resetsAtMs - now);
  const rawExpected = (elapsed / input.windowMs) * 100;
  const expected = Math.min(100, Math.max(0, rawExpected));
  const overBy = input.utilization - expected;

  return {
    expected,
    breached: overBy > 0,
    overBy,
  };
}
