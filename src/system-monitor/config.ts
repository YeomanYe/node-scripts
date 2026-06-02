import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ChannelConfig } from '../shared/notifiers/types';

export interface Thresholds {
  /** CPU 使用率告警阈值 0-100，<=0 表示不监控 */
  cpu_percent: number;
  /** 内存使用率告警阈值 0-100 */
  memory_percent: number;
  /** 1 分钟 load average / 核心数 阈值；1.5 表示 1m load 是核数的 1.5 倍 */
  load1m_per_core: number;
  /** 磁盘使用率阈值 0-100，对所有被监控挂载点生效 */
  disk_percent: number;
}

export interface AlertPolicy {
  /** 连续多少次采样越过阈值才触发告警，避免抖动误报 */
  consecutive_breaches: number;
  /** 同一指标重复告警的最短间隔（分钟） */
  cooldown_minutes: number;
  /** 是否在指标回到阈值以下时发送 recovery 消息 */
  send_recovery: boolean;
  /** 是否每次轮询都发心跳报告（即便没越限）。false 表示只在告警/恢复时发 */
  heartbeat: boolean;
}

export interface MonitorConfig {
  poll: { interval_seconds: number };
  thresholds: Thresholds;
  alert: AlertPolicy;
  /** 监控的磁盘挂载点列表；空数组表示监控所有 df 列出的本地挂载点 */
  disks: string[];
  channels: ChannelConfig[];
}

const DEFAULTS: MonitorConfig = {
  poll: { interval_seconds: 60 },
  thresholds: {
    cpu_percent: 85,
    memory_percent: 90,
    load1m_per_core: 2.0,
    disk_percent: 90,
  },
  alert: {
    consecutive_breaches: 2,
    cooldown_minutes: 30,
    send_recovery: true,
    heartbeat: false,
  },
  disks: ['/'],
  channels: [],
};

function num(raw: unknown, fallback: number, name: string): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${name} 必须是数字`);
  }
  return raw;
}

function bool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'boolean') throw new Error('字段必须是 boolean');
  return raw;
}

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`channels[${index}] 不是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') {
    throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
  }
  for (const key of ['app_id', 'app_secret', 'receive_id'] as const) {
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

export async function loadMonitorConfig(filePath: string): Promise<MonitorConfig> {
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
  const interval = num(pollRaw.interval_seconds, DEFAULTS.poll.interval_seconds, 'poll.interval_seconds');
  if (interval <= 0) throw new Error('poll.interval_seconds 必须 > 0');

  const thrRaw = (obj['thresholds'] as Record<string, unknown> | undefined) ?? {};
  const thresholds: Thresholds = {
    cpu_percent: num(thrRaw['cpu_percent'], DEFAULTS.thresholds.cpu_percent, 'thresholds.cpu_percent'),
    memory_percent: num(thrRaw['memory_percent'], DEFAULTS.thresholds.memory_percent, 'thresholds.memory_percent'),
    load1m_per_core: num(thrRaw['load1m_per_core'], DEFAULTS.thresholds.load1m_per_core, 'thresholds.load1m_per_core'),
    disk_percent: num(thrRaw['disk_percent'], DEFAULTS.thresholds.disk_percent, 'thresholds.disk_percent'),
  };

  const alertRaw = (obj['alert'] as Record<string, unknown> | undefined) ?? {};
  const alert: AlertPolicy = {
    consecutive_breaches: Math.max(
      1,
      Math.floor(num(alertRaw['consecutive_breaches'], DEFAULTS.alert.consecutive_breaches, 'alert.consecutive_breaches'))
    ),
    cooldown_minutes: num(alertRaw['cooldown_minutes'], DEFAULTS.alert.cooldown_minutes, 'alert.cooldown_minutes'),
    send_recovery: bool(alertRaw['send_recovery'], DEFAULTS.alert.send_recovery),
    heartbeat: bool(alertRaw['heartbeat'], DEFAULTS.alert.heartbeat),
  };

  const disksRaw = obj['disks'];
  let disks: string[];
  if (disksRaw === undefined || disksRaw === null) {
    disks = DEFAULTS.disks;
  } else if (Array.isArray(disksRaw)) {
    disks = disksRaw.map((d, i) => {
      if (typeof d !== 'string' || d.length === 0) {
        throw new Error(`disks[${i}] 必须是非空字符串`);
      }
      return d;
    });
  } else {
    throw new Error('disks 必须是字符串数组');
  }

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  return {
    poll: { interval_seconds: interval },
    thresholds,
    alert,
    disks,
    channels,
  };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/system-monitor-config.yaml');
