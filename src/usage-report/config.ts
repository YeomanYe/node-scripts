import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ClaudeAlertWindow } from '../claude-usage/config';
import { CodexAlertWindow } from '../codex-usage/config';
import { MiniMaxAlertWindow } from '../minimax-usage/config';
import { DEFAULT_ENV_FILE as MM_DEFAULT_ENV_FILE, DEFAULT_API_KEY_ENV as MM_DEFAULT_API_KEY_ENV } from '../minimax-usage/env';
import { DEFAULT_MINIMAX_HOST } from '../minimax-usage/quota';
import { getDefaultAuthPath } from '../codex-usage/auth';
import { ChannelConfig } from '../shared/notifiers/types';
import { AggregateConfig, ProviderOverrides } from './types';

const VALID_CLAUDE_WINDOWS: readonly ClaudeAlertWindow[] = ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus'];
const VALID_CODEX_WINDOWS: readonly CodexAlertWindow[] = ['primary', 'secondary'];
const VALID_MINIMAX_WINDOWS: readonly MiniMaxAlertWindow[] = ['interval', 'weekly'];

const DEFAULTS: AggregateConfig = {
  poll: { interval_seconds: 300 },
  channels: [],
  providers: {
    claude: { windows: ['five_hour', 'seven_day'] },
    codex: { windows: ['primary', 'secondary'] },
    minimax: { windows: ['interval', 'weekly'] },
  },
};

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error(`channels[${index}] 不是对象`);
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
  const required = ['app_id', 'app_secret', 'receive_id'] as const;
  for (const key of required) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
      throw new Error(`channels[${index}].${key} 缺失或为空`);
    }
  }
  return {
    type: 'feishu',
    app_id: obj['app_id'] as string,
    app_secret: obj['app_secret'] as string,
    receive_id: obj['receive_id'] as string,
    ...(typeof obj['domain'] === 'string' ? { domain: obj['domain'] } : {}),
    ...(typeof obj['receive_id_type'] === 'string'
      ? { receive_id_type: obj['receive_id_type'] as ChannelConfig['receive_id_type'] }
      : {}),
  };
}

function validateWindows<T extends string>(raw: unknown, valid: readonly T[], label: string, fallback: T[]): T[] {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw)) throw new Error(`providers.${label}.windows 必须是数组`);
  return raw.map((w, i) => {
    if (typeof w !== 'string' || !valid.includes(w as T)) {
      throw new Error(`providers.${label}.windows[${i}] 非法: ${String(w)}`);
    }
    return w as T;
  });
}

function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function validateProviders(raw: unknown): ProviderOverrides {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;

  const claudeRaw = obj['claude'] ?? {};
  const codexRaw = obj['codex'] ?? {};
  const minimaxRaw = obj['minimax'] ?? {};

  return {
    claude: { windows: validateWindows(claudeRaw['windows'], VALID_CLAUDE_WINDOWS, 'claude', DEFAULTS.providers.claude.windows) },
    codex: {
      windows: validateWindows(codexRaw['windows'], VALID_CODEX_WINDOWS, 'codex', DEFAULTS.providers.codex.windows),
      authFile: optString(codexRaw, 'auth_file') ?? getDefaultAuthPath(),
      baseUrl: optString(codexRaw, 'base_url'),
    },
    minimax: {
      windows: validateWindows(minimaxRaw['windows'], VALID_MINIMAX_WINDOWS, 'minimax', DEFAULTS.providers.minimax.windows),
      envFile: optString(minimaxRaw, 'env_file') ?? MM_DEFAULT_ENV_FILE,
      apiKeyEnv: optString(minimaxRaw, 'api_key_env') ?? MM_DEFAULT_API_KEY_ENV,
      apiHost: optString(minimaxRaw, 'api_host') ?? DEFAULT_MINIMAX_HOST,
    },
  };
}

export async function loadPollConfig(filePath: string): Promise<AggregateConfig> {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`配置文件不存在: ${resolved}`);
    throw error;
  }

  const parsed: unknown = YAML.parse(content) ?? {};
  if (typeof parsed !== 'object' || parsed === null) throw new Error('配置文件格式无效：不是对象');
  const obj = parsed as Record<string, unknown>;

  const pollRaw = (obj['poll'] as { interval_seconds?: unknown } | undefined) ?? {};
  const interval =
    typeof pollRaw.interval_seconds === 'number' && pollRaw.interval_seconds > 0
      ? pollRaw.interval_seconds
      : DEFAULTS.poll.interval_seconds;

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  const providers = validateProviders(obj['providers']);

  return { poll: { interval_seconds: interval }, channels, providers };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/usage-report-config.yaml');
