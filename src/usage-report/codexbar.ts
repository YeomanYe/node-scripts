import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { checkProrated } from '../shared/alert/prorated';
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
const DEFAULT_PREFERENCE_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const METRIC_WINDOW_ORDER = ['primary', 'secondary', 'tertiary'] as const;

type CodexBarMetricWindow = (typeof METRIC_WINDOW_ORDER)[number];

const rawWindowSchema = z.object({
  usedPercent: z.number(),
  windowMinutes: z.number().nullable().optional(),
  resetsAt: z.union([z.string(), z.number()]).nullable().optional(),
  resetDescription: z.string().nullable().optional(),
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
  tertiary: rawWindowSchema.nullable().optional(),
  primaryLimit: rawWindowSchema.nullable().optional(),
  secondaryLimit: rawWindowSchema.nullable().optional(),
  tertiaryLimit: rawWindowSchema.nullable().optional(),
  openaiDashboard: z.object({
    primaryLimit: rawWindowSchema.nullable().optional(),
    secondaryLimit: rawWindowSchema.nullable().optional(),
    tertiaryLimit: rawWindowSchema.nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

const rawEntrySchema = z.object({
  provider: z.string(),
  account: z.string().nullable().optional(),
  error: z.unknown().optional(),
  usage: rawUsageSchema.nullable().optional(),
}).passthrough();

const codexBarConfigSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean().optional().default(false),
    }).passthrough()
  ).optional().default([]),
}).passthrough();

export type CodexBarUsageEntry = z.infer<typeof rawEntrySchema>;

export interface CodexBarSettings {
  enabledProviders: string[];
  metricPreferences: Record<string, string>;
}

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

export interface ReadCodexBarMetricPreferenceOptions {
  command?: string;
  plistPath?: string;
  timeoutMs?: number;
  runner?: CodexBarRunner;
}

export interface ReadCodexBarEnabledProvidersOptions {
  configPath?: string;
}

export interface ReadCodexBarSettingsOptions
  extends ReadCodexBarMetricPreferenceOptions,
    ReadCodexBarEnabledProvidersOptions {}

export interface BuildCodexBarProviderReportOptions {
  metricPreference: string;
  nowMs: number;
}

function compactAccountLabel(value: string): string {
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

function stringifyAccountError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return '未知错误';
}

export function getCodexBarProviderUsageArgs(provider: string): readonly string[] {
  if (provider === 'codex') return CODEXBAR_CODEX_USAGE_ARGS;

  const args = ['usage', '--format', 'json', '--provider', provider];
  if (provider === 'claude') {
    args.push('--source', 'oauth');
  }
  return args;
}

export function parseCodexBarProviderEntries(
  stdout: string,
  provider: string
): CodexBarUsageEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`CodexBar 返回了无效 JSON（provider=${provider}）`);
  }

  const parsed = z.array(rawEntrySchema).safeParse(json);
  if (!parsed.success) {
    throw new Error(`CodexBar 返回的 JSON 结构无效（provider=${provider}）`);
  }

  const entries = parsed.data.filter((entry) => entry.provider === provider);
  if (entries.length === 0) {
    throw new Error(`CodexBar 未返回 ${provider} 用量`);
  }
  return entries;
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

const runTextCommand: CodexBarRunner = (command, args, timeoutMs) =>
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
          if (stdout.trim().length > 0) {
            try {
              JSON.parse(stdout);
              resolve(stdout);
              return;
            } catch {
              // 非 JSON 的失败输出继续走统一 CLI 错误。
            }
          }
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });

const defaultRunner: CodexBarRunner = async (command, args, timeoutMs) => {
  try {
    return await runTextCommand(command, args, timeoutMs);
  } catch (error: unknown) {
    throw formatExecError(
      error as {
        code?: string | number | null;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      },
      command,
      timeoutMs
    );
  }
};

export async function fetchCodexBarProviderEntries(
  provider: string,
  options: FetchCodexBarOptions = {}
): Promise<CodexBarUsageEntry[]> {
  const command = options.command ?? 'codexbar';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? defaultRunner;
  const stdout = await runner(command, getCodexBarProviderUsageArgs(provider), timeoutMs);
  return parseCodexBarProviderEntries(stdout, provider);
}

export async function readCodexBarEnabledProviders(
  options: ReadCodexBarEnabledProvidersOptions = {}
): Promise<string[]> {
  const configPath = options.configPath ?? path.join(os.homedir(), '.codexbar', 'config.json');

  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = codexBarConfigSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return [];

    const enabled = parsed.data.providers
      .filter((provider) => provider.enabled && provider.id.trim().length > 0)
      .map((provider) => provider.id.trim());
    return [...new Set(enabled)];
  } catch {
    return [];
  }
}

export async function readCodexBarMetricPreferences(
  options: ReadCodexBarMetricPreferenceOptions = {}
): Promise<Record<string, string>> {
  const command = options.command ?? 'plutil';
  const plistPath =
    options.plistPath ??
    path.join(os.homedir(), 'Library', 'Preferences', 'com.steipete.codexbar.plist');
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREFERENCE_TIMEOUT_MS;
  const runner = options.runner ?? runTextCommand;

  try {
    const stdout = await runner(
      command,
      ['-extract', 'menuBarMetricPreferences', 'json', '-o', '-', plistPath],
      timeoutMs
    );
    const json: unknown = JSON.parse(stdout);
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {};

    return Object.fromEntries(
      Object.entries(json)
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].trim().length > 0
        )
        .map(([provider, preference]) => [provider, preference.trim()])
    );
  } catch {
    return {};
  }
}

export async function readCodexBarMetricPreference(
  options: ReadCodexBarMetricPreferenceOptions = {}
): Promise<string | undefined> {
  const preferences = await readCodexBarMetricPreferences(options);
  return preferences['codex'];
}

export async function readCodexBarSettings(
  options: ReadCodexBarSettingsOptions = {}
): Promise<CodexBarSettings> {
  const [enabledProviders, metricPreferences] = await Promise.all([
    readCodexBarEnabledProviders({ configPath: options.configPath }),
    readCodexBarMetricPreferences(options),
  ]);
  return { enabledProviders, metricPreferences };
}

function formatMetricPreference(preference: string): string {
  if (preference === 'carousel') return 'Carousel';
  return preference.charAt(0).toUpperCase() + preference.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractMetricWindow(
  entry: CodexBarUsageEntry,
  key: CodexBarMetricWindow
): z.infer<typeof rawWindowSchema> | undefined {
  const usage = asRecord(entry.usage) ?? asRecord(entry);
  if (!usage) return undefined;
  const dashboard = asRecord(usage['openaiDashboard']);
  const limitKey = `${key}Limit`;
  const candidate = usage[limitKey] ?? usage[key] ?? dashboard?.[limitKey];
  const parsed = rawWindowSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function resolveMetricWindow(
  entry: CodexBarUsageEntry,
  metricPreference: string
): { key: CodexBarMetricWindow; window: z.infer<typeof rawWindowSchema> } | undefined {
  const candidates =
    metricPreference === 'carousel'
      ? METRIC_WINDOW_ORDER
      : [
          metricPreference,
          ...METRIC_WINDOW_ORDER.filter((key) => key !== metricPreference),
        ];

  for (const candidate of candidates) {
    if (!METRIC_WINDOW_ORDER.includes(candidate as CodexBarMetricWindow)) continue;
    const key = candidate as CodexBarMetricWindow;
    const window = extractMetricWindow(entry, key);
    if (window) return { key, window };
  }
  return undefined;
}

function optionalAccountLabel(entry: CodexBarUsageEntry): string | undefined {
  const usage = asRecord(entry.usage);
  const identity = asRecord(usage?.['identity']);
  const value =
    entry.account ??
    (typeof usage?.['accountEmail'] === 'string' ? usage['accountEmail'] : undefined) ??
    (typeof identity?.['accountEmail'] === 'string' ? identity['accountEmail'] : undefined);
  if (!value) return undefined;
  return compactAccountLabel(value);
}

function optionalLoginMethod(entry: CodexBarUsageEntry): string | undefined {
  const usage = asRecord(entry.usage);
  const identity = asRecord(usage?.['identity']);
  const value = usage?.['loginMethod'] ?? identity?.['loginMethod'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatLocalTimeFromSeconds(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function buildCodexBarProviderReport(
  provider: string,
  entries: CodexBarUsageEntry[],
  options: BuildCodexBarProviderReportOptions
): PollReportLike {
  const resolvedEntries = entries.map((entry) => {
    const accountLabel = optionalAccountLabel(entry);
    if (entry.error !== undefined && entry.error !== null) {
      return {
        status: 'error' as const,
        accountLabel,
        message: stringifyAccountError(entry.error),
      };
    }

    const resolved = resolveMetricWindow(entry, options.metricPreference);
    if (!resolved) {
      return {
        status: 'error' as const,
        accountLabel,
        message: '未返回可用的用量窗口',
      };
    }

    return {
      status: 'ok' as const,
      accountLabel,
      loginMethod: optionalLoginMethod(entry),
      ...resolved,
    };
  });

  const successfulEntries = resolvedEntries.filter((entry) => entry.status === 'ok');
  if (successfulEntries.length === 0) {
    const details = resolvedEntries
      .filter((entry) => entry.status === 'error')
      .map((entry) => `${entry.accountLabel ? `${entry.accountLabel}: ` : ''}${entry.message}`)
      .join('; ');
    throw new Error(`CodexBar ${provider} 用量获取失败${details ? `：${details}` : ''}`);
  }

  let hasAlert = false;
  const summaries: string[] = [];
  const blocks = resolvedEntries.map((entry) => {
    if (entry.status === 'error') {
      summaries.push(
        `${entry.accountLabel ?? 'entry'}[ERROR:${entry.message}]`
      );
      const account = entry.accountLabel ? `**账号**：${entry.accountLabel}\n` : '';
      return `${account}⚠️ 获取失败：${entry.message}`;
    }

    const utilization = entry.window.usedPercent;
    const resetsAt = normalizeResetsAt(entry.window.resetsAt);
    const resetLabel =
      resetsAt !== null && resetsAt > 0
        ? ` ｜结束 ${formatLocalTimeFromSeconds(resetsAt)}`
        : entry.window.resetDescription
          ? ` ｜${entry.window.resetDescription}`
          : '';
    let usageLine: string;
    let summary = `${entry.key}=${utilization.toFixed(1)}%`;

    if (
      !entry.window.windowMinutes ||
      entry.window.windowMinutes <= 0 ||
      resetsAt === null ||
      resetsAt <= 0
    ) {
      usageLine =
        `  ${formatMetricPreference(entry.key)}：${utilization.toFixed(1)}% ` +
        `｜窗口时长或重置时间未知，跳过告警判定${resetLabel}`;
      summary += '(no-alert-window)';
    } else {
      const result = checkProrated({
        utilization,
        resetsAtMs: resetsAt * 1000,
        windowMs: entry.window.windowMinutes * 60_000,
        nowMs: options.nowMs,
      });
      hasAlert ||= result.breached;
      const prefix = result.breached ? '🚨' : '  ';
      const diffLabel = result.breached
        ? `超 ${result.overBy.toFixed(1)}pp`
        : `差 ${result.overBy.toFixed(1)}pp`;
      usageLine =
        `${prefix} ${formatMetricPreference(entry.key)}：${utilization.toFixed(1)}% ` +
        `｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}${resetLabel}`;
      summary += `(exp${result.expected.toFixed(1)}%)`;
    }

    const identity = [
      entry.accountLabel ? `**账号**：${entry.accountLabel}` : '',
      entry.loginMethod ? `**登录方式**：${entry.loginMethod}` : '',
    ].filter(Boolean);
    summaries.push(`${entry.accountLabel ?? 'entry'}[${summary}]`);
    return [...identity, usageLine].join('\n');
  });

  const level: 'info' | 'warn' = hasAlert ? 'warn' : 'info';
  const providerLabel = provider.length > 0
    ? provider.charAt(0).toUpperCase() + provider.slice(1)
    : 'Unknown';
  const title = hasAlert
    ? `🚨 ${providerLabel} 用量告警`
    : `📊 ${providerLabel} 用量报告`;
  const content = [
    `**CodexBar 配额偏好**：${formatMetricPreference(options.metricPreference)}`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
  const summaryLine =
    `entries=${entries.length} preference=${options.metricPreference} ` +
    `${summaries.join(' ')} alert=${hasAlert}`;

  return { title, content, level, summaryLine };
}
