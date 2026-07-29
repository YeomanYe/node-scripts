import { execFile } from 'child_process';
import { z } from 'zod';
import { CodexAlertWindow } from '../codex-usage/config';
import { buildPollReport as buildCodexReport } from '../codex-usage/poll';
import { UsageSnapshot, UsageWindow } from '../codex-usage/types';
import { PollReportLike } from './types';

export const CODEXBAR_CODEX_USAGE_ARGS = [
  'usage',
  '--format',
  'json',
  '--provider',
  'codex',
  '--source',
  'cli',
  '--all-accounts',
] as const;

const DEFAULT_TIMEOUT_MS = 40_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

const rawWindowSchema = z.object({
  usedPercent: z.number(),
  windowMinutes: z.number().nullable().optional(),
  resetsAt: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough();

const rawUsageSchema = z.object({
  accountEmail: z.string().nullable().optional(),
  loginMethod: z.string().nullable().optional(),
  identity: z.object({
    accountEmail: z.string().nullable().optional(),
    loginMethod: z.string().nullable().optional(),
  }).passthrough().nullable().optional(),
  primary: rawWindowSchema.nullable().optional(),
  secondary: rawWindowSchema.nullable().optional(),
}).passthrough();

const rawEntrySchema = z.object({
  provider: z.string(),
  account: z.string().nullable().optional(),
  error: z.unknown().optional(),
  usage: rawUsageSchema.nullable().optional(),
}).passthrough();

export type CodexBarAccountResult =
  | {
      status: 'ok';
      accountLabel: string;
      snapshot: UsageSnapshot;
    }
  | {
      status: 'error';
      accountLabel: string;
      message: string;
    };

export type CodexBarRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<string>;

export interface FetchCodexBarOptions {
  command?: string;
  timeoutMs?: number;
  runner?: CodexBarRunner;
}

export interface BuildCodexBarReportOptions {
  windows: CodexAlertWindow[];
  nowMs: number;
}

function compactAccountLabel(value: string | null | undefined, index: number): string {
  if (!value) return `账号 ${index + 1}`;
  const localPart = value.split('@')[0] || value;
  return localPart.length > 10 ? `${localPart.slice(0, 10)}…` : localPart;
}

function normalizeResetsAt(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function normalizeWindow(
  raw: z.infer<typeof rawWindowSchema> | null | undefined
): UsageWindow | undefined {
  if (!raw) return undefined;
  return {
    usedPercent: raw.usedPercent,
    windowMinutes: raw.windowMinutes ?? null,
    resetsAt: normalizeResetsAt(raw.resetsAt),
  };
}

function stringifyAccountError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return '未知错误';
}

export function parseCodexBarAccountResults(stdout: string): CodexBarAccountResult[] {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error('CodexBar 返回了无效 JSON');
  }

  const parsed = z.array(rawEntrySchema).safeParse(json);
  if (!parsed.success) {
    throw new Error('CodexBar 返回的 JSON 结构无效');
  }

  const entries = parsed.data.filter((entry) => entry.provider === 'codex');
  if (entries.length === 0) {
    throw new Error('CodexBar 未返回任何 Codex 账号用量');
  }

  return entries.map((entry, index) => {
    const accountLabel = compactAccountLabel(
      entry.account ?? entry.usage?.accountEmail ?? entry.usage?.identity?.accountEmail,
      index
    );

    if (entry.error !== undefined && entry.error !== null) {
      return {
        status: 'error' as const,
        accountLabel,
        message: stringifyAccountError(entry.error),
      };
    }

    if (!entry.usage) {
      return {
        status: 'error' as const,
        accountLabel,
        message: '缺少 usage 数据',
      };
    }

    const primary = normalizeWindow(entry.usage.primary);
    const secondary = normalizeWindow(entry.usage.secondary);
    if (!primary && !secondary) {
      return {
        status: 'error' as const,
        accountLabel,
        message: '未返回可用的用量窗口',
      };
    }

    return {
      status: 'ok' as const,
      accountLabel,
      snapshot: {
        planType: entry.usage.loginMethod ?? entry.usage.identity?.loginMethod ?? 'unknown',
        ...(primary ? { primary } : {}),
        ...(secondary ? { secondary } : {}),
        additional: [],
        raw: entry,
      },
    };
  });
}

function formatExecError(
  error: {
    code?: string | number | null;
    killed?: boolean;
    signal?: NodeJS.Signals | null;
  },
  command: string,
  timeoutMs: number
): Error {
  if (error.killed || error.signal === 'SIGTERM') {
    return new Error(`CodexBar CLI 超时（${timeoutMs}ms）`);
  }
  if (error.code === 'ENOENT') {
    return new Error(`找不到 CodexBar CLI：${command}`);
  }
  const code = error.code ? `（${error.code}）` : '';
  return new Error(`CodexBar CLI 执行失败${code}`);
}

const defaultRunner: CodexBarRunner = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout) => {
        if (error) {
          reject(formatExecError(error, command, timeoutMs));
          return;
        }
        resolve(stdout);
      }
    );
  });

export async function fetchCodexBarAccountResults(
  options: FetchCodexBarOptions = {}
): Promise<CodexBarAccountResult[]> {
  const command = options.command ?? 'codexbar';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? defaultRunner;
  const stdout = await runner(command, CODEXBAR_CODEX_USAGE_ARGS, timeoutMs);
  return parseCodexBarAccountResults(stdout);
}

function reportBody(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd < 0) return '';
  const body = content.slice(firstLineEnd + 1);
  return body.startsWith('\n') ? body.slice(1) : body;
}

export function buildCodexBarPollReport(
  results: CodexBarAccountResult[],
  options: BuildCodexBarReportOptions
): PollReportLike {
  const reports = new Map<number, ReturnType<typeof buildCodexReport>>();

  results.forEach((result, index) => {
    if (result.status === 'ok') {
      reports.set(index, buildCodexReport(result.snapshot, options));
    }
  });

  if (reports.size === 0) {
    const detail = results
      .map((result) =>
        result.status === 'error'
          ? `${result.accountLabel}: ${result.message}`
          : result.accountLabel
      )
      .join('; ');
    throw new Error(`CodexBar 所有账号用量获取失败${detail ? `：${detail}` : ''}`);
  }

  const level: 'info' | 'warn' = [...reports.values()].some((report) => report.level === 'warn')
    ? 'warn'
    : 'info';
  const title = level === 'warn' ? '🚨 Codex 多账号用量告警' : '📊 Codex 多账号用量报告';

  const blocks = results.map((result, index) => {
    if (result.status === 'error') {
      return `**账号**：${result.accountLabel}\n⚠️ 获取失败：${result.message}`;
    }

    const report = reports.get(index);
    const body = report ? reportBody(report.content) : '';
    const header = `**账号**：${result.accountLabel} ｜ **Plan**：${result.snapshot.planType}`;
    return body ? `${header}\n${body}` : header;
  });

  const content = [`**账号数**：${results.length}`, '', blocks.join('\n\n')].join('\n');
  const accountSummaries = results.map((result, index) => {
    if (result.status === 'error') {
      return `${result.accountLabel}[ERROR:${result.message}]`;
    }
    return `${result.accountLabel}[${reports.get(index)?.summaryLine ?? 'no-usage'}]`;
  });
  const summaryLine = `accounts=${results.length} ${accountSummaries.join(' ')} alert=${level === 'warn'}`;

  return { title, content, level, summaryLine };
}
