import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome } from '../zai-usage/env';
import {
  ProviderType,
  WindowProvider,
} from '../llm-window-runner/config';

export interface BurnTask {
  provider: string;
  /** 覆盖 provider 的 window (可选；不填则用 provider 自身的 window) */
  window?: string;
  /** 离窗口结束多少秒开始触发 burn */
  leadTimeSeconds: number;
  /** 剩余额度低于此百分比时停止 burn (0-100) */
  minRemainingPercent: number;
  /** 单个窗口内最多 burn 多少次，0 = 不限 */
  maxIterations: number;
  /** 两次 burn 之间的冷却秒数 */
  cooldownSeconds: number;
  /** 脚本非 0 退出时是否停止本窗口 burn */
  stopOnError: boolean;
  cmd?: string;
  command?: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  shell: boolean;
}

export interface BurnRunnerConfig {
  providers: Record<string, WindowProvider>;
  tasks: Record<string, BurnTask>;
  /** loop 模式中，下一次唤醒最长沉睡时长 (秒) */
  loopMaxSleepSeconds: number;
  /** 完成一次执行后，下一轮重算前的最小冷却 (秒) */
  loopMinCooldownSeconds: number;
  /** 拉 snapshot 失败时跳过这一轮的退避时长 (秒) */
  loopBackoffSeconds: number;
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/llm-tail-burn-config.yaml');

const VALID_WINDOWS: Record<ProviderType, readonly string[]> = {
  minimax: ['interval', 'weekly'],
  zai: ['primary', 'secondary'],
  claude: ['fiveHour', 'sevenDay'],
  codex: ['primary', 'secondary'],
};

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
  const type = requiredString(obj['type'], `providers.${name}.type`) as ProviderType;
  if (!VALID_WINDOWS[type]) {
    throw new Error(`providers.${name}.type 不支持：${type}`);
  }
  const window = (optionalString(obj['window'], `providers.${name}.window`) ?? VALID_WINDOWS[type][0])!;
  if (!VALID_WINDOWS[type].includes(window)) {
    throw new Error(`providers.${name}.window=${window} 对 type=${type} 无效，应为 ${VALID_WINDOWS[type].join('/')}`);
  }
  switch (type) {
    case 'minimax':
      return {
        type: 'minimax',
        model: optionalString(obj['model'], `providers.${name}.model`),
        window: window as 'interval' | 'weekly',
        apiKey: optionalString(obj['apiKey'] ?? obj['api_key'], `providers.${name}.apiKey`),
        apiKeyEnv: optionalString(obj['apiKeyEnv'] ?? obj['api_key_env'], `providers.${name}.apiKeyEnv`),
        envFile: optionalString(obj['envFile'] ?? obj['env_file'], `providers.${name}.envFile`),
      };
    case 'zai':
      return {
        type: 'zai',
        window: window as 'primary' | 'secondary',
        apiKey: optionalString(obj['apiKey'] ?? obj['api_key'], `providers.${name}.apiKey`),
        apiKeyEnv: optionalString(obj['apiKeyEnv'] ?? obj['api_key_env'], `providers.${name}.apiKeyEnv`),
        envFile: optionalString(obj['envFile'] ?? obj['env_file'], `providers.${name}.envFile`),
      };
    case 'claude':
      return { type: 'claude', window: window as 'fiveHour' | 'sevenDay' };
    case 'codex':
      return {
        type: 'codex',
        window: window as 'primary' | 'secondary',
        limitId: optionalString(obj['limitId'] ?? obj['limit_id'], `providers.${name}.limitId`),
      };
    default:
      throw new Error(`providers.${name}.type 不支持：${type}`);
  }
}

function normalizeTask(name: string, raw: unknown, providers: Record<string, WindowProvider>): BurnTask {
  const obj = requireObject(raw, `tasks.${name}`);
  const providerName = requiredString(obj['provider'], `tasks.${name}.provider`);
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`tasks.${name}.provider 未注册：${providerName}`);
  }

  const taskWindow = optionalString(obj['window'], `tasks.${name}.window`);
  if (taskWindow) {
    const allowed = VALID_WINDOWS[provider.type];
    if (!allowed.includes(taskWindow)) {
      throw new Error(`tasks.${name}.window=${taskWindow} 对 provider.type=${provider.type} 无效，应为 ${allowed.join('/')}`);
    }
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
    provider: providerName,
    window: taskWindow,
    leadTimeSeconds: positiveNumberWithDefault(
      obj['leadTimeSeconds'] ?? obj['lead_time_seconds'],
      1800,
      `tasks.${name}.leadTimeSeconds`
    ),
    minRemainingPercent: nonNegativeNumberWithDefault(
      obj['minRemainingPercent'] ?? obj['min_remaining_percent'],
      0,
      `tasks.${name}.minRemainingPercent`
    ),
    maxIterations: nonNegativeNumberWithDefault(
      obj['maxIterations'] ?? obj['max_iterations'],
      0,
      `tasks.${name}.maxIterations`
    ),
    cooldownSeconds: positiveNumberWithDefault(
      obj['cooldownSeconds'] ?? obj['cooldown_seconds'],
      60,
      `tasks.${name}.cooldownSeconds`
    ),
    stopOnError: booleanWithDefault(
      obj['stopOnError'] ?? obj['stop_on_error'],
      false,
      `tasks.${name}.stopOnError`
    ),
    cmd,
    command,
    args: normalizeArgs(obj['args'], `tasks.${name}.args`),
    cwd: optionalString(obj['cwd'], `tasks.${name}.cwd`),
    env: normalizeEnv(obj['env'], `tasks.${name}.env`),
    shell: booleanWithDefault(obj['shell'], Boolean(cmd), `tasks.${name}.shell`),
  };
}

export async function loadBurnConfig(filePath: string): Promise<BurnRunnerConfig> {
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
  const tasks: Record<string, BurnTask> = {};
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
  };
}
