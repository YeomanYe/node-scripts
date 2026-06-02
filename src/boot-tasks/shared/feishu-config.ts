import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import type { FeishuChannelConfig } from '../../shared/notifiers/types';

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'local/claude-usage-config.yaml');

interface RawChannel {
  type?: string;
  app_id?: string;
  app_secret?: string;
  domain?: string;
  receive_id?: string;
  receive_id_type?: FeishuChannelConfig['receive_id_type'];
}

interface RawConfig {
  channels?: RawChannel[];
}

export interface LoadResult {
  config: FeishuChannelConfig | null;
  source: string;
  reason?: string;
}

export function loadFeishuConfig(configPath?: string): LoadResult {
  const resolved = configPath
    ? path.resolve(configPath)
    : process.env.BOOT_TASKS_NOTIFY_CONFIG
      ? path.resolve(process.env.BOOT_TASKS_NOTIFY_CONFIG)
      : DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(resolved)) {
    return { config: null, source: resolved, reason: 'file not found' };
  }

  let raw: RawConfig;
  try {
    raw = parseYaml(fs.readFileSync(resolved, 'utf8')) as RawConfig;
  } catch (err) {
    return { config: null, source: resolved, reason: `yaml parse failed: ${(err as Error).message}` };
  }

  const channel = raw?.channels?.find((c) => c?.type === 'feishu');
  if (!channel || !channel.app_id || !channel.app_secret || !channel.receive_id) {
    return { config: null, source: resolved, reason: 'no valid feishu channel in config' };
  }

  return {
    config: {
      type: 'feishu',
      app_id: channel.app_id,
      app_secret: channel.app_secret,
      domain: channel.domain,
      receive_id: channel.receive_id,
      receive_id_type: channel.receive_id_type ?? 'chat_id',
    },
    source: resolved,
  };
}
