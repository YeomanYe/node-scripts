import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { expandHome } from '../zai-usage/env';
import {
  ProviderType,
  WindowProvider,
} from '../llm-window-runner/config';

export type AgentKind = 'tail' | 'rate' | 'projection';
export type MatchMode = 'all' | 'any';

interface BurnAgentBase {
  /** 引用 providers.<name> */
  provider: string;
  /** 覆盖 provider 的 window (可选；不填则用 provider 自身的 window) */
  window?: string;
}

export interface TailAgent extends BurnAgentBase {
  kind: 'tail';
  /** 离窗口结束多少秒开始触发 burn */
  leadTimeSeconds: number;
  /** 剩余额度低于此百分比时停止 burn (0-100) */
  minRemainingPercent: number;
}

export interface RateAgent extends BurnAgentBase {
  kind: 'rate';
  /** 剩余% / 剩余小时数 > ratePerHour 时认为有 tail 可烧 */
  ratePerHour: number;
}

export interface ProjectionAgent extends BurnAgentBase {
  kind: 'projection';
  /** 引用 providers.<name> 作为长窗口 (7d) */
  pairedProvider: string;
  /** 覆盖 pairedProvider 的 window (可选) */
  pairedWindow?: string;
  /** 一个完整短窗口跑满相当于消耗长窗口的多少 % (例如 claude=8, zai=20) */
  shortWindowConsumePercent: number;
}

export type BurnAgent = TailAgent | RateAgent | ProjectionAgent;

export interface BurnTask {
  /** 至少 1 个 agent；多个 agent 按 match 字段组合 */
  agents: BurnAgent[];
  /** all = 全部 ready 才 fire；any = 任一 ready 即 fire。默认 any */
  match: MatchMode;
  /** 单 task window 内最多 burn 多少次，0 = 不限 */
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

/** 按 provider.type 推断默认 kind（用户未显式声明时使用） */
const DEFAULT_KIND_BY_TYPE: Record<ProviderType, AgentKind> = {
  minimax: 'tail',
  codex: 'rate',
  claude: 'projection',
  zai: 'projection',
};

/** projection kind 的 shortWindowConsumePercent 默认值 */
const DEFAULT_SHORT_WINDOW_CONSUME: Partial<Record<ProviderType, number>> = {
  claude: 8,
  zai: 20,
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

function assertWindowValid(window: string | undefined, type: ProviderType, label: string): void {
  if (!window) return;
  const allowed = VALID_WINDOWS[type];
  if (!allowed.includes(window)) {
    throw new Error(`${label}=${window} 对 type=${type} 无效，应为 ${allowed.join('/')}`);
  }
}

/** 用于复合 provider 自动展开的长窗口后缀 (内部名，用户不需要写) */
export const LONG_PROVIDER_SUFFIX = '#long';

/**
 * 复合 provider：claude/zai 不写 window 时，自动展开为 short + long 两个内部 provider，
 * 注册名为 `${name}` (短窗) 和 `${name}${LONG_PROVIDER_SUFFIX}` (长窗)。
 * 这样 BurnAgent 在 projection 模式下可以省略 pairedProvider。
 */
function normalizeProvider(name: string, raw: unknown): WindowProvider[] {
  const obj = requireObject(raw, `providers.${name}`);
  const type = requiredString(obj['type'], `providers.${name}.type`) as ProviderType;
  if (!VALID_WINDOWS[type]) {
    throw new Error(`providers.${name}.type 不支持：${type}`);
  }

  const hasWindow = obj['window'] !== undefined && obj['window'] !== null;

  // claude/zai 复合模式：不写 window → 自动 short + long
  if ((type === 'claude' || type === 'zai') && !hasWindow) {
    const [shortW, longW] = VALID_WINDOWS[type];
    return [
      makeProviderEntry(type, shortW!, obj, name),
      makeProviderEntry(type, longW!, obj, name),
    ];
  }

  // 单窗口模式：window 不写时取 type 默认
  const window = (optionalString(obj['window'], `providers.${name}.window`) ?? VALID_WINDOWS[type][0])!;
  assertWindowValid(window, type, `providers.${name}.window`);
  return [makeProviderEntry(type, window, obj, name)];
}

function makeProviderEntry(
  type: ProviderType,
  window: string,
  obj: Record<string, unknown>,
  name: string
): WindowProvider {
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

function normalizeAgent(
  idx: number,
  raw: unknown,
  providers: Record<string, WindowProvider>
): BurnAgent {
  const label = `tasks.*.agents[${idx}]`;
  const obj = requireObject(raw, label);

  const providerName = requiredString(obj['provider'], `${label}.provider`);
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`${label}.provider 未注册：${providerName}`);
  }

  const taskWindow = optionalString(obj['window'], `${label}.window`);
  assertWindowValid(taskWindow, provider.type, `${label}.window`);

  // kind 由 provider.type 唯一推断，不接受用户显式声明
  if (obj['kind'] !== undefined && obj['kind'] !== null) {
    throw new Error(
      `${label}.kind 不允许显式配置，由 provider.type=${provider.type} 自动推断为 ${DEFAULT_KIND_BY_TYPE[provider.type]}`
    );
  }
  const kind: AgentKind = DEFAULT_KIND_BY_TYPE[provider.type];

  const base = { provider: providerName, window: taskWindow };

  switch (kind) {
    case 'tail':
      return {
        ...base,
        kind: 'tail',
        leadTimeSeconds: positiveNumberWithDefault(
          obj['leadTimeSeconds'] ?? obj['lead_time_seconds'],
          1800,
          `${label}.leadTimeSeconds`
        ),
        minRemainingPercent: nonNegativeNumberWithDefault(
          obj['minRemainingPercent'] ?? obj['min_remaining_percent'],
          0,
          `${label}.minRemainingPercent`
        ),
      };
    case 'rate':
      return {
        ...base,
        kind: 'rate',
        ratePerHour: positiveNumberWithDefault(
          obj['ratePerHour'] ?? obj['rate_per_hour'],
          2,
          `${label}.ratePerHour`
        ),
      };
    case 'projection': {
      // pairedProvider 可省略：默认取 `${providerName}#long`（复合 provider 模式）
      const pairedName =
        optionalString(obj['pairedProvider'] ?? obj['paired_provider'], `${label}.pairedProvider`) ??
        `${providerName}${LONG_PROVIDER_SUFFIX}`;
      const pairedProvider = providers[pairedName];
      if (!pairedProvider) {
        throw new Error(
          `${label}.pairedProvider 未注册：${pairedName}（提示：若 providers.${providerName} 写了 window，请改为复合模式——省略 window 让系统自动展开 5h+7d）`
        );
      }
      if (pairedProvider.type !== provider.type) {
        throw new Error(
          `${label}.pairedProvider 类型 ${pairedProvider.type} 必须与 provider 类型 ${provider.type} 一致`
        );
      }
      const pairedWindow = optionalString(obj['pairedWindow'] ?? obj['paired_window'], `${label}.pairedWindow`);
      assertWindowValid(pairedWindow, pairedProvider.type, `${label}.pairedWindow`);

      const defaultConsume = DEFAULT_SHORT_WINDOW_CONSUME[provider.type];
      if (defaultConsume == null) {
        throw new Error(`${label}.kind=projection 仅适用于 claude/zai，当前 provider.type=${provider.type}`);
      }
      return {
        ...base,
        kind: 'projection',
        pairedProvider: pairedName,
        pairedWindow,
        shortWindowConsumePercent: positiveNumberWithDefault(
          obj['shortWindowConsumePercent'] ?? obj['short_window_consume_percent'],
          defaultConsume,
          `${label}.shortWindowConsumePercent`
        ),
      };
    }
    default:
      throw new Error(`${label}.kind 不支持：${kind satisfies never}`);
  }
}

function normalizeTask(
  name: string,
  raw: unknown,
  providers: Record<string, WindowProvider>
): BurnTask {
  const obj = requireObject(raw, `tasks.${name}`);

  const agentsRaw = obj['agents'];
  if (!Array.isArray(agentsRaw) || agentsRaw.length === 0) {
    throw new Error(`tasks.${name}.agents 必须是非空数组`);
  }
  const agents = agentsRaw.map((a, i) => normalizeAgent(i, a, providers));

  const matchRaw = optionalString(obj['match'], `tasks.${name}.match`);
  const match: MatchMode = matchRaw ? (matchRaw as MatchMode) : 'any';
  if (match !== 'all' && match !== 'any') {
    throw new Error(`tasks.${name}.match 无效：${matchRaw}（应为 all 或 any）`);
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
    agents,
    match,
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
    const list = normalizeProvider(name, raw);
    providers[name] = list[0]!;
    if (list[1]) {
      providers[`${name}${LONG_PROVIDER_SUFFIX}`] = list[1];
    }
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
