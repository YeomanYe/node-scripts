#!/usr/bin/env node

// system-status: macOS 系统状态一次性快照 → 飞书
// 指标:电量、CPU%、内存%、1m load/核、磁盘%
//
// 使用:
//   system-status                     # 采样 + 发飞书
//   system-status --no-notify         # 只打印不发
//   system-status --json              # JSON 输出原始采样(配合 --no-notify)
//   system-status --config <yaml>     # 自定义飞书 channel 配置
//   system-status --disks /,/Volumes/X
//
// pm2 触发模式:cron_restart '*/15 * * * *',脚本跑完即退

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import { sendFeishuCard } from '../shared/notifiers/feishu';
import type { FeishuChannelConfig } from '../shared/notifiers/types';
import { collectSample, SystemSample, BatterySample } from './metrics';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), 'Documents/projects/node-scripts/local/claude-usage-config.yaml');

// 一次性快照模式下的阈值:用来在卡片中标记 🚨 + 决定整体 level
const THRESHOLDS = {
  cpu_percent: 85,
  memory_percent: 90,
  load1m_per_core: 2.0,
  disk_percent: 90,
  battery_low_percent: 20,
};

function fmtBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)}${units[i]}`;
}

function fmtLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  parts.push(`${m}分`);
  return parts.join(' ');
}

function batteryIcon(b: BatterySample | null): string {
  if (!b) return '❓';
  if (b.percentage <= 20) return '🪫';
  if (b.percentage >= 80) return '🔋';
  return '⚡️';
}

interface MetricLine {
  flag: '🚨' | '  ';
  label: string;
  value: string;
  threshold: string;
  extra: string;
}

function buildLines(sample: SystemSample): { lines: MetricLine[]; breaches: number } {
  const lines: MetricLine[] = [];
  let breaches = 0;
  const push = (breach: boolean, label: string, value: string, threshold: string, extra = ''): void => {
    if (breach) breaches++;
    lines.push({ flag: breach ? '🚨' : '  ', label, value, threshold, extra });
  };

  if (sample.battery) {
    const b = sample.battery;
    const breach = !b.onAC && b.percentage <= THRESHOLDS.battery_low_percent;
    const extra = b.timeRemaining && b.timeRemaining !== '0:00'
      ? ` (${/charging/i.test(b.state) && !/not charging/i.test(b.state) ? '充满还需' : '剩余'} ${b.timeRemaining})`
      : '';
    push(breach, '电量', `${b.percentage}%`, `${THRESHOLDS.battery_low_percent}%`, ` ${b.onAC ? '🔌' : '🔋'} ${b.state}${extra}`);
  }

  push(
    sample.cpuPercent >= THRESHOLDS.cpu_percent,
    'CPU',
    `${sample.cpuPercent.toFixed(1)}%`,
    `${THRESHOLDS.cpu_percent}%`,
    ` (${sample.cpuCount} 核)`
  );

  push(
    sample.memoryPercent >= THRESHOLDS.memory_percent,
    '内存',
    `${sample.memoryPercent.toFixed(1)}%`,
    `${THRESHOLDS.memory_percent}%`,
    ` (${fmtBytes(sample.memoryUsedBytes)} / ${fmtBytes(sample.memoryTotalBytes)})`
  );

  push(
    sample.load1mPerCore >= THRESHOLDS.load1m_per_core,
    `1m load/核`,
    sample.load1mPerCore.toFixed(2),
    THRESHOLDS.load1m_per_core.toFixed(2),
    ` (1m=${sample.load[0].toFixed(2)} 5m=${sample.load[1].toFixed(2)} 15m=${sample.load[2].toFixed(2)})`
  );

  for (const d of sample.disks) {
    push(
      d.percent >= THRESHOLDS.disk_percent,
      `磁盘 ${d.mount}`,
      `${d.percent.toFixed(1)}%`,
      `${THRESHOLDS.disk_percent}%`,
      ` (${fmtBytes(d.usedBytes)} / ${fmtBytes(d.totalBytes)})`
    );
  }

  return { lines, breaches };
}

function buildCard(sample: SystemSample): { title: string; content: string; level: 'info' | 'warn' } {
  const { lines, breaches } = buildLines(sample);
  const level: 'info' | 'warn' = breaches > 0 ? 'warn' : 'info';
  const icon = breaches > 0 ? '🚨' : batteryIcon(sample.battery);
  const title = breaches > 0
    ? `${icon} 系统状态告警 · ${breaches} 项越限 (${sample.hostname})`
    : `${icon} 系统状态 · ${sample.hostname}`;

  const body: string[] = [];
  body.push(`**主机**: ${sample.hostname} ｜ **uptime**: ${fmtUptime(sample.uptimeSeconds)}`);
  body.push('');
  for (const l of lines) {
    body.push(`${l.flag} **${l.label}**: ${l.value}｜阈值 ${l.threshold}${l.extra}`);
  }
  body.push('');
  body.push(`**时间**: ${fmtLocalTime(sample.tsMs)}`);

  return { title, content: body.join('\n'), level };
}

interface RawChannel {
  type?: string;
  app_id?: string;
  app_secret?: string;
  domain?: string;
  receive_id?: string;
  receive_id_type?: FeishuChannelConfig['receive_id_type'];
}

function loadFeishuConfig(configPath: string): FeishuChannelConfig | null {
  if (!fs.existsSync(configPath)) {
    console.warn(`[system-status] feishu config not found: ${configPath}`);
    return null;
  }
  try {
    const raw = parseYaml(fs.readFileSync(configPath, 'utf8')) as { channels?: RawChannel[] };
    const channel = raw?.channels?.find((c) => c?.type === 'feishu');
    if (!channel?.app_id || !channel.app_secret || !channel.receive_id) {
      console.warn(`[system-status] no valid feishu channel in ${configPath}`);
      return null;
    }
    return {
      type: 'feishu',
      app_id: channel.app_id,
      app_secret: channel.app_secret,
      domain: channel.domain,
      receive_id: channel.receive_id,
      receive_id_type: channel.receive_id_type ?? 'chat_id',
    };
  } catch (err) {
    console.warn(`[system-status] failed to load feishu config:`, err);
    return null;
  }
}

interface CliOptions {
  config: string;
  notify: boolean;
  json: boolean;
  disks?: string;
}

function summaryLine(sample: SystemSample, breaches: number): string {
  const pieces = [
    sample.battery ? `battery=${sample.battery.percentage}%` : 'battery=n/a',
    `cpu=${sample.cpuPercent.toFixed(1)}%`,
    `mem=${sample.memoryPercent.toFixed(1)}%`,
    `load1m/core=${sample.load1mPerCore.toFixed(2)}`,
  ];
  for (const d of sample.disks) pieces.push(`${d.mount}=${d.percent.toFixed(1)}%`);
  pieces.push(`breaches=${breaches}`);
  return pieces.join(' ');
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('system-status')
    .description('macOS 系统状态快照(电量/CPU/内存/load/磁盘),通过飞书发送报告')
    .option('-c, --config <path>', 'feishu 通道配置 yaml', process.env.SYSTEM_STATUS_NOTIFY_CONFIG || DEFAULT_CONFIG_PATH)
    .option('--no-notify', '只输出到 stdout,不发飞书')
    .option('--json', 'JSON 输出原始采样(配合 --no-notify 使用)')
    .option('--disks <list>', '逗号分隔的挂载点列表,默认 "/"; 留空字符串表示所有本地挂载点')
    .parse(process.argv);

  const opts = program.opts<CliOptions>();

  // 不传 --disks 时让 collectSample 选平台默认值(darwin: /System/Volumes/Data)
  const disks = opts.disks === undefined
    ? undefined
    : opts.disks.length === 0
      ? []
      : opts.disks.split(',').map((s) => s.trim()).filter(Boolean);

  const sample = await collectSample(disks === undefined ? {} : { disks });

  if (opts.json) {
    process.stdout.write(JSON.stringify(sample, null, 2) + '\n');
    return;
  }

  const { lines: _lines, breaches } = buildLines(sample);
  console.log(`[system-status] ${fmtLocalTime(sample.tsMs)} ${summaryLine(sample, breaches)}`);

  if (!opts.notify) return;

  const configPath = path.resolve(opts.config.replace(/^~/, os.homedir()));
  const config = loadFeishuConfig(configPath);
  if (!config) {
    console.warn(`[system-status] skip feishu notification`);
    return;
  }

  const { title, content, level } = buildCard(sample);
  try {
    await sendFeishuCard(config, title, content, level);
    console.log(`[system-status] feishu sent (title="${title}", level=${level})`);
  } catch (err) {
    console.error(`[system-status] feishu send failed:`, err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[system-status] failed:', err);
  process.exit(1);
});
