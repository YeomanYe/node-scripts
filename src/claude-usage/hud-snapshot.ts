import * as fs from 'fs';
import * as path from 'path';
import { UsageData } from './types';

/**
 * claude-hud 写出的用量快照默认路径（与 vibe-kanban 后端约定一致）。
 * 该快照由 claude-hud 通过 Claude Code statusline stdin 拿到进程内部的
 * 真实 rate_limits 后写出，来源是本地进程间通信，不受 Anthropic OAuth
 * usage endpoint 限流影响。
 */
export function defaultSnapshotPath(): string {
  return path.join(
    process.env['HOME'] ?? '',
    '.claude',
    'plugins',
    'claude-hud',
    'usage-snapshot.json'
  );
}

/** 快照被视为新鲜的最长时间（毫秒），与 claude-hud 默认 externalUsageFreshnessMs 一致 */
export const DEFAULT_SNAPSHOT_FRESHNESS_MS = 5 * 60 * 1000;

interface HudSnapshotWindow {
  used_percentage?: number | null;
  resets_at?: string | null;
}

interface HudSnapshot {
  updated_at?: string;
  five_hour?: HudSnapshotWindow | null;
  seven_day?: HudSnapshotWindow | null;
}

export interface ReadSnapshotOptions {
  /** 自定义快照路径（测试用） */
  snapshotPath?: string;
  /** 自定义新鲜度阈值（测试用） */
  freshnessMs?: number;
  /** 自定义当前时间（测试用） */
  nowMs?: number;
  /** 注入的 fs.readFileSync（测试用） */
  readFileSync?: typeof fs.readFileSync;
}

function toResetInfo(window: HudSnapshotWindow | null | undefined) {
  if (!window || typeof window.used_percentage !== 'number') return null;
  const resetsAt = typeof window.resets_at === 'string' ? window.resets_at : '';
  return { utilization: window.used_percentage, resetsAt };
}

/**
 * 读取 claude-hud 写出的用量快照并转换为 UsageData。
 *
 * 用作 fetchUsage 被 Anthropic OAuth endpoint 限流时的回退：claude-hud 的数据
 * 来自 Claude Code 进程内部状态（statusline stdin），本地传递、不限流。
 *
 * 返回 null 的情况：快照缺失 / 过期 / 格式无效 / five_hour 与 seven_day 任一缺失。
 * 要求两个窗口都有效是为了和 fetchUsage 的输出语义保持一致。
 */
export function readClaudeHudSnapshot(options: ReadSnapshotOptions = {}): UsageData | null {
  const snapshotPath = options.snapshotPath ?? defaultSnapshotPath();
  const freshnessMs = options.freshnessMs ?? DEFAULT_SNAPSHOT_FRESHNESS_MS;
  const nowMs = options.nowMs ?? Date.now();
  const readFileSync = options.readFileSync ?? fs.readFileSync;

  let raw: string;
  try {
    raw = readFileSync(snapshotPath, 'utf-8');
  } catch {
    return null;
  }

  let snap: HudSnapshot;
  try {
    snap = JSON.parse(raw) as HudSnapshot;
  } catch {
    return null;
  }

  // 新鲜度校验
  if (typeof snap.updated_at !== 'string') return null;
  const updatedMs = Date.parse(snap.updated_at);
  if (!Number.isFinite(updatedMs)) return null;
  if (nowMs - updatedMs > freshnessMs) return null;

  const fiveHour = toResetInfo(snap.five_hour);
  const sevenDay = toResetInfo(snap.seven_day);
  // 两个窗口都有效才返回，避免半截数据误导告警判断
  if (!fiveHour || !sevenDay) return null;

  // claude-hud 快照不包含按模型细分与额外用量，回退时置空
  return {
    fiveHour,
    sevenDay,
    sevenDaySonnet: null,
    sevenDayOpus: null,
    sevenDayCowork: null,
    extraUsage: null,
  };
}
