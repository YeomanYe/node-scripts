import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome } from '../minimax-usage/env';

export type QuotaWindowName = 'interval' | 'weekly';
export type ProviderType = 'minimax';

export interface MiniMaxProviderConfig {
  type: 'minimax';
  model?: string;
  window: QuotaWindowName;
  minHeadroomPercent: number;
  allowOnUnknownQuota: boolean;
}

export type ProviderConfig = MiniMaxProviderConfig;

export interface RegisteredTask {
  cmd?: string;
  command?: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  shell: boolean;
  model?: string;
  window?: QuotaWindowName;
  minHeadroomPercent?: number;
}

export interface GatedRunConfig {
  provider: ProviderConfig;
  skipExitCode: number;
  tasks: Record<string, RegisteredTask>;
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/minimax-gated-run-config.yaml');

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value.trim();
}

function numberWithDefault(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是数字`);
  }
  return value;
}

function booleanWithDefault(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
  return value;
}

function normalizeWindow(value: unknown, fallback: QuotaWindowName, label: string): QuotaWindowName {
  if (value === undefined || value === null) return fallback;
  if (value === 'interval' || value === 'weekly') return value;
  throw new Error(`${label} 必须是 interval 或 weekly`);
}

function optionalWindow(value: unknown, label: string): QuotaWindowName | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeWindow(value, 'interval', label);
}

function normalizeArgs(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return [...value];
}

function normalizeEnv(value: unknown, label: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  const raw = requireObject(value, label);
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'string') throw new Error(`${label}.${key} 必须是字符串`);
    env[key] = val;
  }
  return env;
}

function normalizeTask(name: string, raw: unknown): RegisteredTask {
  const obj = requireObject(raw, `tasks.${name}`);
  const cmd = optionalString(obj['cmd'], `tasks.${name}.cmd`);
  const command = optionalString(obj['command'], `tasks.${name}.command`);
  if (!cmd && !command) {
    throw new Error(`tasks.${name} 必须配置 cmd 或 command`);
  }
  if (cmd && command) {
    throw new Error(`tasks.${name} 不能同时配置 cmd 和 command`);
  }

  return {
    cmd,
    command,
    args: normalizeArgs(obj['args'], `tasks.${name}.args`),
    cwd: optionalString(obj['cwd'], `tasks.${name}.cwd`),
    env: normalizeEnv(obj['env'], `tasks.${name}.env`),
    shell: booleanWithDefault(obj['shell'], Boolean(cmd), `tasks.${name}.shell`),
    model: optionalString(obj['model'], `tasks.${name}.model`),
    window: optionalWindow(obj['window'], `tasks.${name}.window`),
    minHeadroomPercent:
      obj['min_headroom_percent'] !== undefined
        ? numberWithDefault(obj['min_headroom_percent'], 0, `tasks.${name}.min_headroom_percent`)
        : obj['minHeadroomPercent'] !== undefined
          ? numberWithDefault(obj['minHeadroomPercent'], 0, `tasks.${name}.minHeadroomPercent`)
          : undefined,
  };
}

function normalizeTasks(raw: unknown): Record<string, RegisteredTask> {
  const tasks = requireObject(raw, 'tasks');
  const result: Record<string, RegisteredTask> = {};
  for (const [name, task] of Object.entries(tasks)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`任务名无效: ${name}`);
    }
    result[name] = normalizeTask(name, task);
  }
  return result;
}

function normalizeProviderType(value: unknown, label: string): ProviderType {
  if (value === undefined || value === null || value === 'minimax') return 'minimax';
  throw new Error(`${label} 目前只支持 minimax`);
}

function readNumberAlias(obj: Record<string, unknown>, snake: string, camel: string, fallback: number, label: string): number {
  if (obj[snake] !== undefined) return numberWithDefault(obj[snake], fallback, `${label}.${snake}`);
  return numberWithDefault(obj[camel], fallback, `${label}.${camel}`);
}

function readBooleanAlias(obj: Record<string, unknown>, snake: string, camel: string, fallback: boolean, label: string): boolean {
  if (obj[snake] !== undefined) return booleanWithDefault(obj[snake], fallback, `${label}.${snake}`);
  return booleanWithDefault(obj[camel], fallback, `${label}.${camel}`);
}

function normalizeProvider(raw: unknown, root: Record<string, unknown>): ProviderConfig {
  if (raw === undefined || raw === null || typeof raw === 'string') {
    return {
      type: normalizeProviderType(raw, 'provider'),
      model: optionalString(root['model'], 'model'),
      window: normalizeWindow(root['window'], 'interval', 'window'),
      minHeadroomPercent: readNumberAlias(root, 'min_headroom_percent', 'minHeadroomPercent', 0, '配置文件'),
      allowOnUnknownQuota: readBooleanAlias(root, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, '配置文件'),
    };
  }

  const obj = requireObject(raw, 'provider');
  const type = normalizeProviderType(obj['type'], 'provider.type');
  return {
    type,
    model: optionalString(obj['model'] ?? root['model'], 'provider.model'),
    window: normalizeWindow(obj['window'] ?? root['window'], 'interval', 'provider.window'),
    minHeadroomPercent:
      obj['min_headroom_percent'] !== undefined || obj['minHeadroomPercent'] !== undefined
        ? readNumberAlias(obj, 'min_headroom_percent', 'minHeadroomPercent', 0, 'provider')
        : readNumberAlias(root, 'min_headroom_percent', 'minHeadroomPercent', 0, '配置文件'),
    allowOnUnknownQuota:
      obj['allow_on_unknown_quota'] !== undefined || obj['allowOnUnknownQuota'] !== undefined
        ? readBooleanAlias(obj, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, 'provider')
        : readBooleanAlias(root, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, '配置文件'),
  };
}

export async function loadGatedRunConfig(filePath: string): Promise<GatedRunConfig> {
  const resolved = path.resolve(expandHome(filePath));
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在: ${resolved}`);
    }
    throw error;
  }

  const parsed: unknown = YAML.parse(content) ?? {};
  const obj = requireObject(parsed, '配置文件');
  return {
    provider: normalizeProvider(obj['provider'], obj),
    skipExitCode:
      obj['skip_exit_code'] !== undefined
        ? numberWithDefault(obj['skip_exit_code'], 0, 'skip_exit_code')
        : numberWithDefault(obj['skipExitCode'], 0, 'skipExitCode'),
    tasks: normalizeTasks(obj['tasks']),
  };
}
