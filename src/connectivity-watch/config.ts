import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type { ChannelConfig } from '../shared/notifiers/types';

export interface WatchTarget {
  key: string;
  label: string;
  url: string;
  method: string;
  successStatus: string;
}

export interface ConnectivityWatchConfig {
  intervalSeconds: number;
  timeoutMs: number;
  stateFile: string;
  channels: ChannelConfig[];
  targets: WatchTarget[];
}

interface RawChannel {
  type?: unknown;
  app_id?: unknown;
  app_secret?: unknown;
  domain?: unknown;
  receive_id?: unknown;
  receive_id_type?: unknown;
}

interface RawTarget {
  key?: unknown;
  label?: unknown;
  url?: unknown;
  method?: unknown;
  success_status?: unknown;
  successStatus?: unknown;
}

interface RawConfig {
  channels?: unknown;
  connectivity_watch?: {
    interval_seconds?: unknown;
    timeout_seconds?: unknown;
    state_file?: unknown;
    targets?: unknown;
  };
}

export const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'local/codex-usage-config.yaml');
export const DEFAULT_STATE_FILE = path.resolve(process.cwd(), 'local/connectivity-watch-state.json');

export const DEFAULT_TARGETS: WatchTarget[] = [
  {
    key: 'google',
    label: 'Google',
    url: 'https://www.google.com/generate_204',
    method: 'GET',
    successStatus: '200-399',
  },
  {
    key: 'codex',
    label: 'Codex / ChatGPT',
    url: 'https://chatgpt.com/cdn-cgi/trace',
    method: 'GET',
    successStatus: '200-399',
  },
  {
    key: 'claude',
    label: 'Claude',
    url: 'https://claude.ai',
    method: 'GET',
    successStatus: '200-399',
  },
  {
    key: 'github',
    label: 'GitHub',
    url: 'https://github.com',
    method: 'GET',
    successStatus: '200-399',
  },
];

function positiveNumber(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonEmptyString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`channels[${index}] 不是对象`);
  }

  const obj = raw as RawChannel;
  if (obj.type !== 'feishu') {
    throw new Error(`未知通道类型 channels[${index}].type=${String(obj.type)}`);
  }

  const appId = nonEmptyString(obj.app_id);
  const appSecret = nonEmptyString(obj.app_secret);
  const receiveId = nonEmptyString(obj.receive_id);
  if (!appId || !appSecret || !receiveId) {
    throw new Error(`channels[${index}] 缺少 app_id/app_secret/receive_id`);
  }

  return {
    type: 'feishu',
    app_id: appId,
    app_secret: appSecret,
    receive_id: receiveId,
    ...(typeof obj.domain === 'string' ? { domain: obj.domain } : {}),
    ...(typeof obj.receive_id_type === 'string'
      ? { receive_id_type: obj.receive_id_type as ChannelConfig['receive_id_type'] }
      : {}),
  };
}

function validateTarget(raw: unknown, index: number): WatchTarget {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`connectivity_watch.targets[${index}] 不是对象`);
  }

  const obj = raw as RawTarget;
  const key = nonEmptyString(obj.key);
  const label = nonEmptyString(obj.label);
  const url = nonEmptyString(obj.url);
  if (!key || !label || !url) {
    throw new Error(`connectivity_watch.targets[${index}] 缺少 key/label/url`);
  }

  return {
    key,
    label,
    url,
    method: nonEmptyString(obj.method)?.toUpperCase() ?? 'GET',
    successStatus: nonEmptyString(obj.success_status) ?? nonEmptyString(obj.successStatus) ?? '200-399',
  };
}

function resolveStateFile(raw: unknown): string {
  const value = nonEmptyString(raw);
  if (!value) return DEFAULT_STATE_FILE;
  return path.resolve(value.replace(/^~(?=$|\/)/, process.env.HOME ?? ''));
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<ConnectivityWatchConfig> {
  const resolved = path.resolve(configPath.replace(/^~(?=$|\/)/, process.env.HOME ?? ''));
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在: ${resolved}`);
    }
    throw error;
  }

  const parsed = (YAML.parse(content) ?? {}) as RawConfig;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('配置文件格式无效：不是对象');
  }

  const channelsRaw = parsed.channels ?? [];
  if (!Array.isArray(channelsRaw)) {
    throw new Error('channels 必须是数组');
  }
  const channels = channelsRaw.map(validateChannel);
  if (channels.length === 0) {
    throw new Error('channels 至少需要一个 feishu 通道');
  }

  const watchRaw = parsed.connectivity_watch ?? {};
  const targetsRaw = watchRaw.targets;
  const targets = Array.isArray(targetsRaw) && targetsRaw.length > 0
    ? targetsRaw.map(validateTarget)
    : DEFAULT_TARGETS;

  return {
    intervalSeconds: positiveNumber(watchRaw.interval_seconds, 60),
    timeoutMs: positiveNumber(watchRaw.timeout_seconds, 10) * 1000,
    stateFile: resolveStateFile(watchRaw.state_file),
    channels,
    targets,
  };
}
