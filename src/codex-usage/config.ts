import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ChannelConfig } from '../shared/notifiers/types';

export type CodexAlertWindow = 'primary' | 'secondary';

const VALID_WINDOWS: readonly CodexAlertWindow[] = ['primary', 'secondary'];

export interface PollConfig {
  poll: { interval_seconds: number };
  alert: { windows: CodexAlertWindow[] };
  channels: ChannelConfig[];
}

const DEFAULTS: PollConfig = {
  poll: { interval_seconds: 300 },
  alert: { windows: ['primary', 'secondary'] },
  channels: [],
};

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`channels[${index}] 不是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') {
    throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
  }
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

function validateWindows(raw: unknown): CodexAlertWindow[] {
  if (raw === undefined) return DEFAULTS.alert.windows;
  if (!Array.isArray(raw)) throw new Error('alert.windows 必须是数组');
  return raw.map((w, i) => {
    if (typeof w !== 'string' || !VALID_WINDOWS.includes(w as CodexAlertWindow)) {
      throw new Error(`alert.windows[${i}] 非法: ${String(w)}`);
    }
    return w as CodexAlertWindow;
  });
}

export async function loadPollConfig(filePath: string): Promise<PollConfig> {
  const resolved = path.resolve(filePath);
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
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('配置文件格式无效：不是对象');
  }
  const obj = parsed as Record<string, unknown>;

  const pollRaw = (obj['poll'] as { interval_seconds?: unknown } | undefined) ?? {};
  const interval =
    typeof pollRaw.interval_seconds === 'number' && pollRaw.interval_seconds > 0
      ? pollRaw.interval_seconds
      : DEFAULTS.poll.interval_seconds;

  const alertRaw = (obj['alert'] as { windows?: unknown } | undefined) ?? {};
  const windows = validateWindows(alertRaw.windows);

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  return {
    poll: { interval_seconds: interval },
    alert: { windows },
    channels,
  };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/codex-usage-config.yaml');
