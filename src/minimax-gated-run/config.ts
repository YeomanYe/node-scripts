import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome } from '../minimax-usage/env';

export type QuotaWindowName = 'interval' | 'weekly';

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
  model?: string;
  window: QuotaWindowName;
  minHeadroomPercent: number;
  allowOnUnknownQuota: boolean;
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
    model: optionalString(obj['model'], 'model'),
    window: normalizeWindow(obj['window'], 'interval', 'window'),
    minHeadroomPercent:
      obj['min_headroom_percent'] !== undefined
        ? numberWithDefault(obj['min_headroom_percent'], 0, 'min_headroom_percent')
        : numberWithDefault(obj['minHeadroomPercent'], 0, 'minHeadroomPercent'),
    allowOnUnknownQuota:
      obj['allow_on_unknown_quota'] !== undefined
        ? booleanWithDefault(obj['allow_on_unknown_quota'], false, 'allow_on_unknown_quota')
        : booleanWithDefault(obj['allowOnUnknownQuota'], false, 'allowOnUnknownQuota'),
    skipExitCode:
      obj['skip_exit_code'] !== undefined
        ? numberWithDefault(obj['skip_exit_code'], 0, 'skip_exit_code')
        : numberWithDefault(obj['skipExitCode'], 0, 'skipExitCode'),
    tasks: normalizeTasks(obj['tasks']),
  };
}
