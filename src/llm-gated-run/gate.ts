import { checkProrated } from '../shared/alert/prorated';
import { MiniMaxModelQuota, MiniMaxQuotaSnapshot, MiniMaxQuotaWindow } from '../minimax-usage/types';
import { QuotaWindowName } from './config';

export interface GateInput {
  snapshot: MiniMaxQuotaSnapshot;
  model?: string;
  window: QuotaWindowName;
  minHeadroomPercent: number;
  allowOnUnknownQuota: boolean;
  nowMs?: number;
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
  modelName?: string;
  window: QuotaWindowName;
  usedPercent?: number;
  expectedPercent?: number;
  overByPercent?: number;
  remainingMs?: number;
  resetAtMs?: number;
}

function selectModel(snapshot: MiniMaxQuotaSnapshot, modelName?: string): MiniMaxModelQuota | undefined {
  if (modelName) {
    return snapshot.models.find((model) => model.modelName === modelName);
  }
  return snapshot.models[0];
}

function deriveUsedPercent(window: MiniMaxQuotaWindow): number | null {
  if (window.usedPercent !== null) return window.usedPercent;
  if (
    window.totalCount !== null &&
    window.totalCount > 0 &&
    window.usageCount !== null &&
    window.usageCount >= 0
  ) {
    return Math.max(0, Math.min(100, (window.usageCount / window.totalCount) * 100));
  }
  return null;
}

function getWindowMs(window: MiniMaxQuotaWindow): number | null {
  if (window.startMs !== null && window.endMs !== null) {
    const windowMs = window.endMs - window.startMs;
    if (Number.isFinite(windowMs) && windowMs > 0) return windowMs;
  }
  return null;
}

function unknownDecision(reason: string, input: GateInput): GateDecision {
  return {
    allowed: input.allowOnUnknownQuota,
    reason: input.allowOnUnknownQuota
      ? `${reason}，配置允许未知额度时执行`
      : `${reason}，为避免超额已跳过`,
    window: input.window,
  };
}

export function evaluateMiniMaxGate(input: GateInput): GateDecision {
  const model = selectModel(input.snapshot, input.model);
  if (!model) {
    return unknownDecision(input.model ? `未找到 MiniMax 模型额度: ${input.model}` : '未返回 MiniMax 模型额度', input);
  }

  const quotaWindow = model[input.window];
  const usedPercent = deriveUsedPercent(quotaWindow);
  const windowMs = getWindowMs(quotaWindow);
  const resetAtMs = quotaWindow.endMs;

  if (usedPercent === null) {
    return unknownDecision(`${model.modelName} ${input.window} 缺少已用百分比`, input);
  }
  if (windowMs === null || resetAtMs === null) {
    return unknownDecision(`${model.modelName} ${input.window} 缺少窗口起止时间`, input);
  }

  const prorated = checkProrated({
    utilization: usedPercent,
    resetsAtMs: resetAtMs,
    windowMs,
    nowMs: input.nowMs,
  });
  const overWithHeadroom = prorated.overBy + input.minHeadroomPercent;
  const allowed = overWithHeadroom < 0;
  const suffix =
    input.minHeadroomPercent > 0
      ? `，需预留 ${input.minHeadroomPercent.toFixed(1)}pct`
      : '';

  return {
    allowed,
    reason: allowed
      ? `当前用量 ${usedPercent.toFixed(1)}% < 线性预算 ${prorated.expected.toFixed(1)}%${suffix}，允许执行`
      : `当前用量 ${usedPercent.toFixed(1)}% >= 线性预算 ${prorated.expected.toFixed(1)}%${suffix}，跳过执行`,
    modelName: model.modelName,
    window: input.window,
    usedPercent,
    expectedPercent: prorated.expected,
    overByPercent: prorated.overBy,
    remainingMs: quotaWindow.remainsMs ?? resetAtMs - (input.nowMs ?? Date.now()),
    resetAtMs,
  };
}
