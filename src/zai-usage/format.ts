import { ZaiLimitWindow, ZaiUsageSnapshot } from './types';

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

export function formatWindowLine(window: ZaiLimitWindow, label: string): string {
  const reset = window.resetsAtMs && window.resetsAtMs > 0 ? ` ｜重置 ${formatLocalTime(window.resetsAtMs)}` : '';
  const win = window.windowLabel ?? window.type;
  return [
    `- ${label}（${win}）`,
    `已用 ${percent(window.usedPercent)}`,
    `剩余 ${window.remaining ?? '?'}`,
    reset,
  ].join(' ｜ ');
}

export function formatUsageText(snapshot: ZaiUsageSnapshot, nowMs = Date.now()): string {
  const lines: string[] = [];
  if (snapshot.primary) lines.push(formatWindowLine(snapshot.primary, '主窗口'));
  if (snapshot.secondary) lines.push(formatWindowLine(snapshot.secondary, '次窗口'));
  const plan = snapshot.planName ? ` ｜套餐 ${snapshot.planName}` : '';
  return [
    `Z.ai 用量${plan} ｜当前时间 ${formatLocalTime(nowMs)}`,
    '',
    ...(lines.length > 0 ? lines : ['未返回用量数据']),
  ].join('\n');
}
