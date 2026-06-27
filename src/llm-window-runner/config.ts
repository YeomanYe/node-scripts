import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome } from '../zai-usage/env';

export type ProviderType = 'minimax' | 'zai' | 'claude' | 'codex';

export type MinimaxWindowName = 'interval' | 'weekly';
export type ZaiWindowName = 'primary' | 'secondary';
export type ClaudeWindowName = 'fiveHour' | 'sevenDay';
export type CodexWindowName = 'primary' | 'secondary';

export interface MinimaxProvider {
  type: 'minimax';
  model?: string | undefined;
  window: MinimaxWindowName;
  apiKey?: string | undefined;
  apiKeyEnv?: string | undefined;
  envFile?: string | undefined;
}

export interface ZaiProvider {
  type: 'zai';
  window: ZaiWindowName;
  apiKey?: string | undefined;
  apiKeyEnv?: string | undefined;
  envFile?: string | undefined;
}

export interface ClaudeProvider {
  type: 'claude';
  window: ClaudeWindowName;
}

export interface CodexProvider {
  type: 'codex';
  window: CodexWindowName;
  /** 用于 additional_rate_limits 的查询 (如有) */
  limitId?: string | undefined;
}

export type WindowProvider = MinimaxProvider | ZaiProvider | ClaudeProvider | CodexProvider;

export interface WindowTask {
  provider: string;
  scheduledTime: string; // "HH:MM"
  cmd?: string | undefined;
  command?: string | undefined;
  args: string[];
  cwd?: string | undefined;
  env: Record<string, string>;
  shell: boolean;
}

export interface WindowRunnerConfig {
  providers: Record<string, WindowProvider>;
  tasks: Record<string, WindowTask>;
  /** loop 模式中，下一次唤醒最长沉睡时长 (秒)，避免久睡错过 provider 数据变化 */
  loopMaxSleepSeconds: number;
  /** 完成一次执行后，下一轮重算前的最小冷却 (秒)，避免抖动 */
  loopMinCooldownSeconds: number;
  /** 拉 snapshot 失败时跳过这一轮的退避时长 (秒) */
  loopBackoffSeconds: number;
  /** 触发窗口前/后多少毫秒之内视作命中 (用于 loop 判定到点) */
  fireToleranceMs: number;
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/llm-window-runner.config.yaml');

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

function requiredString(value: unknown, label: string): string {
  const out = optionalString(value, label);
  if (!out) throw new Error(`${label} 必填`);
  return out;
}

function booleanWithDefault(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
  return value;
}

function positiveNumberWithDefault(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} 必须是 > 0 的数字`);
  }
  return value;
}

function nonNegativeNumberWithDefault(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是 >= 0 的数字`);
  }
  return value;
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

function normalizeProvider(name: string, raw: unknown): WindowProvider {
  const obj = requireObject(raw, `providers.${name}`);
  const type = requiredString(obj['type'], `providers.${name}.type`);
  switch (type) {
    case 'minimax': {
      const window = (optionalString(obj['window'], `providers.${name}.window`) ?? 'interval') as MinimaxWindowName;
      if (window !== 'interval' && window !== 'weekly') {
        throw new Error(`providers.${name}.window 必须是 interval 或 weekly`);
      }
      return {
        type: 'minimax',
        model: optionalString(obj['model'], `providers.${name}.model`),
        window,
        apiKey: optionalString(obj['apiKey'] ?? obj['api_key'], `providers.${name}.apiKey`),
        apiKeyEnv: optionalString(obj['apiKeyEnv'] ?? obj['api_key_env'], `providers.${name}.apiKeyEnv`),
        envFile: optionalString(obj['envFile'] ?? obj['env_file'], `providers.${name}.envFile`),
      };
    }
    case 'zai': {
      const window = (optionalString(obj['window'], `providers.${name}.window`) ?? 'primary') as ZaiWindowName;
      if (window !== 'primary' && window !== 'secondary') {
        throw new Error(`providers.${name}.window 必须是 primary 或 secondary`);
      }
      return {
        type: 'zai',
        window,
        apiKey: optionalString(obj['apiKey'] ?? obj['api_key'], `providers.${name}.apiKey`),
        apiKeyEnv: optionalString(obj['apiKeyEnv'] ?? obj['api_key_env'], `providers.${name}.apiKeyEnv`),
        envFile: optionalString(obj['envFile'] ?? obj['env_file'], `providers.${name}.envFile`),
      };
    }
    case 'claude': {
      const window = (optionalString(obj['window'], `providers.${name}.window`) ?? 'fiveHour') as ClaudeWindowName;
      if (window !== 'fiveHour' && window !== 'sevenDay') {
        throw new Error(`providers.${name}.window 必须是 fiveHour 或 sevenDay`);
      }
      return { type: 'claude', window };
    }
    case 'codex': {
      const window = (optionalString(obj['window'], `providers.${name}.window`) ?? 'primary') as CodexWindowName;
      if (window !== 'primary' && window !== 'secondary') {
        throw new Error(`providers.${name}.window 必须是 primary 或 secondary`);
      }
      return {
        type: 'codex',
        window,
        limitId: optionalString(obj['limitId'] ?? obj['limit_id'], `providers.${name}.limitId`),
      };
    }
    default:
      throw new Error(`providers.${name}.type 不支持：${type}`);
  }
}

function normalizeTask(name: string, raw: unknown, providers: Record<string, WindowProvider>): WindowTask {
  const obj = requireObject(raw, `tasks.${name}`);
  const provider = requiredString(obj['provider'], `tasks.${name}.provider`);
  if (!providers[provider]) {
    throw new Error(`tasks.${name}.provider 未注册：${provider}`);
  }
  const scheduledTime = requiredString(obj['scheduledTime'] ?? obj['scheduled_time'], `tasks.${name}.scheduledTime`);
  if (!/^\d{1,2}:\d{2}$/.test(scheduledTime)) {
    throw new Error(`tasks.${name}.scheduledTime 必须是 "HH:MM"：${scheduledTime}`);
  }

  const cmd = optionalString(obj['cmd'], `tasks.${name}.cmd`);
  const command = optionalString(obj['command'], `tasks.${name}.command`);
  if (!cmd && !command) {
    throw new Error(`tasks.${name} 必须配置 cmd 或 command`);
  }
  if (cmd && command) {
    throw new Error(`tasks.${name} 不能同时配置 cmd 和 command`);
  }

  return {
    provider,
    scheduledTime,
    cmd,
    command,
    args: normalizeArgs(obj['args'], `tasks.${name}.args`),
    cwd: optionalString(obj['cwd'], `tasks.${name}.cwd`),
    env: normalizeEnv(obj['env'], `tasks.${name}.env`),
    shell: booleanWithDefault(obj['shell'], Boolean(cmd), `tasks.${name}.shell`),
  };
}

export async function loadWindowRunnerConfig(filePath: string): Promise<WindowRunnerConfig> {
  const resolved = path.resolve(expandHome(filePath));
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在：${resolved}`);
    }
    throw error;
  }

  const parsed: unknown = YAML.parse(content) ?? {};
  const root = requireObject(parsed, '配置文件');

  const providersRaw = requireObject(root['providers'], 'providers');
  const providers: Record<string, WindowProvider> = {};
  for (const [name, raw] of Object.entries(providersRaw)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`provider 名无效：${name}`);
    providers[name] = normalizeProvider(name, raw);
  }
  if (Object.keys(providers).length === 0) throw new Error('providers 至少需要配置一个');

  const tasksRaw = requireObject(root['tasks'], 'tasks');
  const tasks: Record<string, WindowTask> = {};
  for (const [name, raw] of Object.entries(tasksRaw)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`任务名无效：${name}`);
    tasks[name] = normalizeTask(name, raw, providers);
  }

  return {
    providers,
    tasks,
    loopMaxSleepSeconds: positiveNumberWithDefault(
      root['loopMaxSleepSeconds'] ?? root['loop_max_sleep_seconds'],
      600,
      'loopMaxSleepSeconds'
    ),
    loopMinCooldownSeconds: nonNegativeNumberWithDefault(
      root['loopMinCooldownSeconds'] ?? root['loop_min_cooldown_seconds'],
      30,
      'loopMinCooldownSeconds'
    ),
    loopBackoffSeconds: positiveNumberWithDefault(
      root['loopBackoffSeconds'] ?? root['loop_backoff_seconds'],
      120,
      'loopBackoffSeconds'
    ),
    fireToleranceMs: positiveNumberWithDefault(
      root['fireToleranceMs'] ?? root['fire_tolerance_ms'],
      60 * 1000,
      'fireToleranceMs'
    ),
  };
}
