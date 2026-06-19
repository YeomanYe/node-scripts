import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome, readMiniMaxApiKey } from '../minimax-usage/env';

export type QuotaWindowName = 'interval' | 'weekly';
export type ProviderType = 'minimax';
export type SchedulerMode = 'sequence';

export interface SchedulerConfig {
  mode: SchedulerMode;
  runImmediately: boolean;
  intervalSeconds: number;
  jitterSeconds: number;
  stopOnError: boolean;
}

export interface MiniMaxProviderConfig {
  type: 'minimax';
  model?: string;
  window: QuotaWindowName;
  minHeadroomPercent: number;
  allowOnUnknownQuota: boolean;
  scheduler?: SchedulerConfig;
  tasks: string[];
  apiKey?: string; // 明文 api key(优先级最高;一般建议改用 apiKeyEnv 避免明文)
  apiKeyEnv?: string; // 从 .env/环境变量读取的变量名,覆盖全局 --api-key-env
  envFile?: string; // dotenv 文件路径,覆盖全局 --env-file
}

export type ProviderConfig = MiniMaxProviderConfig;

export interface RegisteredTask {
  provider?: string;
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
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
  skipExitCode: number;
  tasks: Record<string, RegisteredTask>;
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/llm-gated-run-config.yaml');

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

function positiveNumberWithDefault(value: unknown, fallback: number, label: string): number {
  const number = numberWithDefault(value, fallback, label);
  if (number <= 0) throw new Error(`${label} 必须大于 0`);
  return number;
}

function nonNegativeNumberWithDefault(value: unknown, fallback: number, label: string): number {
  const number = numberWithDefault(value, fallback, label);
  if (number < 0) throw new Error(`${label} 必须大于等于 0`);
  return number;
}

function normalizeWindow(value: unknown, fallback: QuotaWindowName, label: string): QuotaWindowName {
  if (value === undefined || value === null) return fallback;
  if (value === 'interval' || value === 'weekly') return value;
  throw new Error(`${label} 必须是 interval 或 weekly`);
}

function normalizeSchedulerMode(value: unknown, label: string): SchedulerMode {
  if (value === undefined || value === null || value === 'sequence') return 'sequence';
  throw new Error(`${label} 目前只支持 sequence`);
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

function normalizeStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
  return value.map((item) => item.trim());
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
    provider: optionalString(obj['provider'], `tasks.${name}.provider`),
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

function normalizeScheduler(raw: unknown, label: string): SchedulerConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const obj = requireObject(raw, label);
  return {
    mode: normalizeSchedulerMode(obj['mode'], `${label}.mode`),
    runImmediately:
      obj['run_immediately'] !== undefined
        ? booleanWithDefault(obj['run_immediately'], true, `${label}.run_immediately`)
        : booleanWithDefault(obj['runImmediately'], true, `${label}.runImmediately`),
    intervalSeconds:
      obj['interval_seconds'] !== undefined
        ? positiveNumberWithDefault(obj['interval_seconds'], 900, `${label}.interval_seconds`)
        : positiveNumberWithDefault(obj['intervalSeconds'], 900, `${label}.intervalSeconds`),
    jitterSeconds:
      obj['jitter_seconds'] !== undefined
        ? nonNegativeNumberWithDefault(obj['jitter_seconds'], 0, `${label}.jitter_seconds`)
        : nonNegativeNumberWithDefault(obj['jitterSeconds'], 0, `${label}.jitterSeconds`),
    stopOnError:
      obj['stop_on_error'] !== undefined
        ? booleanWithDefault(obj['stop_on_error'], false, `${label}.stop_on_error`)
        : booleanWithDefault(obj['stopOnError'], false, `${label}.stopOnError`),
  };
}

function readProviderKeyFields(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  label: string
): { apiKey?: string; apiKeyEnv?: string; envFile?: string } {
  const pick = (snake: string, camel: string): unknown =>
    primary[snake] ?? primary[camel] ?? fallback[snake] ?? fallback[camel];
  return {
    apiKey: optionalString(pick('api_key', 'apiKey'), `${label}.api_key`),
    apiKeyEnv: optionalString(pick('api_key_env', 'apiKeyEnv'), `${label}.api_key_env`),
    envFile: optionalString(pick('env_file', 'envFile'), `${label}.env_file`),
  };
}

function normalizeProvider(raw: unknown, root: Record<string, unknown>, label: string): ProviderConfig {
  if (raw === undefined || raw === null || typeof raw === 'string') {
    return {
      type: normalizeProviderType(raw, label),
      model: optionalString(root['model'], `${label}.model`),
      window: normalizeWindow(root['window'], 'interval', `${label}.window`),
      minHeadroomPercent: readNumberAlias(root, 'min_headroom_percent', 'minHeadroomPercent', 0, label),
      allowOnUnknownQuota: readBooleanAlias(root, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, label),
      scheduler: normalizeScheduler(root['scheduler'], `${label}.scheduler`),
      tasks: normalizeStringList(root['provider_tasks'] ?? root['providerTasks'], `${label}.tasks`),
      ...readProviderKeyFields(root, root, label),
    };
  }

  const obj = requireObject(raw, label);
  const type = normalizeProviderType(obj['type'], `${label}.type`);
  return {
    type,
    model: optionalString(obj['model'] ?? root['model'], `${label}.model`),
    window: normalizeWindow(obj['window'] ?? root['window'], 'interval', `${label}.window`),
    minHeadroomPercent:
      obj['min_headroom_percent'] !== undefined || obj['minHeadroomPercent'] !== undefined
        ? readNumberAlias(obj, 'min_headroom_percent', 'minHeadroomPercent', 0, label)
        : readNumberAlias(root, 'min_headroom_percent', 'minHeadroomPercent', 0, label),
    allowOnUnknownQuota:
      obj['allow_on_unknown_quota'] !== undefined || obj['allowOnUnknownQuota'] !== undefined
        ? readBooleanAlias(obj, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, label)
        : readBooleanAlias(root, 'allow_on_unknown_quota', 'allowOnUnknownQuota', false, label),
    scheduler: normalizeScheduler(obj['scheduler'], `${label}.scheduler`),
    tasks: normalizeStringList(obj['tasks'], `${label}.tasks`),
    ...readProviderKeyFields(obj, root, label),
  };
}

function normalizeProviderName(name: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`${label} 名称无效: ${name}`);
  }
  return name;
}

function normalizeProviders(root: Record<string, unknown>): {
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
} {
  if (root['providers'] !== undefined) {
    const rawProviders = requireObject(root['providers'], 'providers');
    const providers: Record<string, ProviderConfig> = {};
    for (const [name, raw] of Object.entries(rawProviders)) {
      const normalizedName = normalizeProviderName(name, 'provider');
      providers[normalizedName] = normalizeProvider(raw, {}, `providers.${normalizedName}`);
    }

    const names = Object.keys(providers);
    if (names.length === 0) throw new Error('providers 至少需要配置一个 provider');

    const defaultProvider =
      optionalString(root['default_provider'] ?? root['defaultProvider'], 'default_provider') ?? names[0]!;
    if (!providers[defaultProvider]) {
      throw new Error(`default_provider 未注册: ${defaultProvider}`);
    }
    return { providers, defaultProvider };
  }

  return {
    providers: {
      default: normalizeProvider(root['provider'], root, 'provider'),
    },
    defaultProvider: 'default',
  };
}

function validateTaskProviders(config: {
  providers: Record<string, ProviderConfig>;
  tasks: Record<string, RegisteredTask>;
}): void {
  for (const [name, task] of Object.entries(config.tasks)) {
    if (task.provider && !config.providers[task.provider]) {
      throw new Error(`tasks.${name}.provider 未注册: ${task.provider}`);
    }
  }
  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const taskName of provider.tasks) {
      if (!config.tasks[taskName]) {
        throw new Error(`providers.${providerName}.tasks 引用了未注册任务: ${taskName}`);
      }
    }
  }
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
  const providerConfig = normalizeProviders(obj);
  const result: GatedRunConfig = {
    ...providerConfig,
    skipExitCode:
      obj['skip_exit_code'] !== undefined
        ? numberWithDefault(obj['skip_exit_code'], 0, 'skip_exit_code')
        : numberWithDefault(obj['skipExitCode'], 0, 'skipExitCode'),
    tasks: normalizeTasks(obj['tasks']),
  };
  validateTaskProviders(result);
  return result;
}

/**
 * 解析某 provider 实际使用的 api key:
 * 1) provider.apiKey 明文(优先级最高);
 * 2) 否则从 (provider.envFile ?? 全局 envFile) 里读 (provider.apiKeyEnv ?? 全局 apiKeyEnv) 变量。
 * 让不同 provider 各用各的 key(不同变量名/不同 .env/明文)。
 */
export async function resolveProviderApiKey(
  provider: ProviderConfig,
  fallback: { envFile: string; apiKeyEnv: string }
): Promise<string> {
  if (provider.apiKey && provider.apiKey.trim().length > 0) {
    return provider.apiKey.trim();
  }
  return readMiniMaxApiKey({
    envFile: provider.envFile ?? fallback.envFile,
    apiKeyEnv: provider.apiKeyEnv ?? fallback.apiKeyEnv,
  });
}
