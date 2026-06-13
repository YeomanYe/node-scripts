import { spawn } from 'child_process';
import {
  MiniMaxModelQuota,
  MiniMaxQuotaSnapshot,
  MiniMaxQuotaWindow,
  MiniMaxRawModelRemain,
  MiniMaxRawQuota,
} from './types';

export interface FetchQuotaOptions {
  apiKey: string;
  command?: string;
  commandArgs?: string[];
  timeoutMs?: number;
}

const DEFAULT_COMMAND = 'npx';
const DEFAULT_COMMAND_ARGS = ['-y', 'mmx-cli'];

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function percentUsed(remainingPercent: number | null): number | null {
  if (remainingPercent === null) return null;
  return Math.max(0, Math.min(100, 100 - remainingPercent));
}

function buildWindow(options: {
  startMs: unknown;
  endMs: unknown;
  remainsMs: unknown;
  totalCount: unknown;
  usageCount: unknown;
  remainingPercent: unknown;
  status: unknown;
}): MiniMaxQuotaWindow {
  const remainingPercent = asNumber(options.remainingPercent);
  return {
    startMs: asNumber(options.startMs),
    endMs: asNumber(options.endMs),
    remainsMs: asNumber(options.remainsMs),
    totalCount: asNumber(options.totalCount),
    usageCount: asNumber(options.usageCount),
    remainingPercent,
    usedPercent: percentUsed(remainingPercent),
    status: asNumber(options.status),
  };
}

function normalizeModel(raw: MiniMaxRawModelRemain): MiniMaxModelQuota {
  const modelName =
    typeof raw.model_name === 'string' && raw.model_name.length > 0
      ? raw.model_name
      : 'unknown';
  return {
    modelName,
    interval: buildWindow({
      startMs: raw.start_time,
      endMs: raw.end_time,
      remainsMs: raw.remains_time,
      totalCount: raw.current_interval_total_count,
      usageCount: raw.current_interval_usage_count,
      remainingPercent: raw.current_interval_remaining_percent,
      status: raw.current_interval_status,
    }),
    weekly: buildWindow({
      startMs: raw.weekly_start_time,
      endMs: raw.weekly_end_time,
      remainsMs: raw.weekly_remains_time,
      totalCount: raw.current_weekly_total_count,
      usageCount: raw.current_weekly_usage_count,
      remainingPercent: raw.current_weekly_remaining_percent,
      status: raw.current_weekly_status,
    }),
  };
}

export function extractJsonPayload(output: string): MiniMaxRawQuota {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('mmx quota 未返回 JSON');
  }
  return JSON.parse(output.slice(start, end + 1)) as MiniMaxRawQuota;
}

export function normalizeQuota(raw: MiniMaxRawQuota): MiniMaxQuotaSnapshot {
  const remains = Array.isArray(raw.model_remains) ? raw.model_remains : [];
  return {
    models: remains.map((item) => normalizeModel(item as MiniMaxRawModelRemain)),
    raw,
  };
}

function commandFailedMessage(code: number | null, stderr: string, stdout: string): string {
  const raw = `${stderr}\n${stdout}`.trim();
  if (!raw) return `mmx quota 执行失败 (${code ?? 'unknown'})`;
  return `mmx quota 执行失败 (${code ?? 'unknown'}): ${raw}`;
}

export function fetchMiniMaxQuota(options: FetchQuotaOptions): Promise<MiniMaxQuotaSnapshot> {
  return new Promise((resolve, reject) => {
    const command = options.command ?? DEFAULT_COMMAND;
    const commandArgs = options.commandArgs ?? DEFAULT_COMMAND_ARGS;
    const args = [
      ...commandArgs,
      '--api-key',
      options.apiKey,
      '--output',
      'json',
      '--quiet',
      '--non-interactive',
      'quota',
      'show',
    ];
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutMs = options.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`mmx quota 超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`mmx quota 启动失败: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(commandFailedMessage(code, stderr, stdout)));
        return;
      }
      try {
        resolve(normalizeQuota(extractJsonPayload(stdout)));
      } catch (error) {
        reject(error);
      }
    });
  });
}
