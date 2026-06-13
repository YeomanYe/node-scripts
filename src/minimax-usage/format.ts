import { MiniMaxModelQuota, MiniMaxQuotaSnapshot } from './types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '未知';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function percent(value: number | null): string {
  return value === null ? '未知' : `${value.toFixed(0)}%`;
}

function count(usage: number | null, total: number | null): string {
  if (usage === null && total === null) return '';
  return ` ｜次数 ${usage ?? '?'} / ${total ?? '?'}`;
}

export function formatModelLine(model: MiniMaxModelQuota): string {
  return [
    `- ${model.modelName}`,
    `5小时剩余 ${percent(model.interval.remainingPercent)}（已用 ${percent(model.interval.usedPercent)}）`,
    `周剩余 ${percent(model.weekly.remainingPercent)}（已用 ${percent(model.weekly.usedPercent)}）`,
    `5小时结束 ${formatLocalTime(model.interval.endMs)}`,
    `周结束 ${formatLocalTime(model.weekly.endMs)}${count(model.interval.usageCount, model.interval.totalCount)}`,
  ].join(' ｜ ');
}

export function formatQuotaText(snapshot: MiniMaxQuotaSnapshot, nowMs = Date.now()): string {
  const lines = snapshot.models.map(formatModelLine);
  return [
    `MiniMax Token Plan 用量 ｜ 当前时间 ${formatLocalTime(nowMs)}`,
    '',
    ...(lines.length > 0 ? lines : ['未返回模型用量数据']),
  ].join('\n');
}
