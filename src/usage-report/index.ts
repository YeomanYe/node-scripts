#!/usr/bin/env node

import { Command } from 'commander';
import { buildNotifiers } from '../shared/notifiers';
import { DEFAULT_CONFIG_PATH, loadPollConfig } from './config';
import { collectAllReports } from './collect';
import { buildAggregateCard } from './aggregate';
import { runPoll } from './poll';

const stopSignal = { stopped: false };

interface CliOptions {
  json?: boolean;
  notify?: boolean;
  poll?: string | true;
  config: string;
}

function setupSignalHandlers(): void {
  const cleanup = (): void => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

export function parseSeconds(raw: string | true, defaultSec: number): number {
  const seconds = raw === true ? defaultSec : parseInt(raw, 10);
  if (isNaN(seconds) || seconds < 1) throw new Error('interval must be a positive integer');
  return seconds;
}

/** 单次发送一张聚合卡片到配置的 channels */
async function notifyOnce(options: CliOptions): Promise<void> {
  const config = await loadPollConfig(options.config);
  const nowMs = Date.now();
  const results = await collectAllReports({ providers: config.providers, nowMs });
  const card = buildAggregateCard(results, { nowMs });

  const notifiers = buildNotifiers(config.channels);
  const results2 = await Promise.allSettled(
    notifiers.map((n) => n.send({ title: card.title, content: card.content, level: card.level }))
  );
  const failed = results2.map((r, i) => ({ r, i })).filter((x) => x.r.status === 'rejected');
  if (failed.length > 0) {
    const messages = failed.map((x) => {
      const reason = x.r.status === 'rejected' ? (x.r.reason instanceof Error ? x.r.reason.message : String(x.r.reason)) : '';
      return `${notifiers[x.i]?.name ?? x.i}: ${reason}`;
    });
    throw new Error(`通知发送失败: ${messages.join('; ')}`);
  }
  process.stdout.write(`[${new Date().toISOString()}] ${card.summaryLine}\n`);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('usage-report')
    .description('聚合 Claude/Codex/MiniMax/Z.ai 用量，合并为一张飞书卡片发送到 claude 通道')
    .option('-p, --poll [seconds]', '常驻轮询并推送聚合卡片（无值则用 config.poll.interval_seconds）')
    .option('--notify', '单次发送一张聚合卡片（与 --poll 互斥）')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_PATH)
    .option('--json', '打印各 provider 聚合结果 JSON（调试用，不发送）')
    .action(async (options: CliOptions) => {
      if (options.poll !== undefined && options.notify) {
        process.stderr.write('错误: --poll 与 --notify 互斥\n');
        process.exit(1);
      }

      if (options.poll !== undefined) {
        const config = await loadPollConfig(options.config);
        const intervalSec = options.poll === true ? config.poll.interval_seconds : parseSeconds(options.poll, 300);
        process.stdout.write(
          `[${new Date().toISOString()}] usage-report poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
        );
        await runPoll({ intervalSec, config, signal: stopSignal });
        return;
      }

      if (options.notify) {
        await notifyOnce(options);
        return;
      }

      // 默认 / --json：collect 并打印（调试，不发送）
      const config = await loadPollConfig(options.config);
      const results = await collectAllReports({ providers: config.providers, nowMs: Date.now() });
      const card = buildAggregateCard(results, { nowMs: Date.now() });
      if (options.json) {
        process.stdout.write(JSON.stringify({ results, card }, null, 2) + '\n');
      } else {
        process.stdout.write(`${card.title}\n\n${card.content}\n`);
      }
    });
  return program;
}

if (require.main === module) {
  setupSignalHandlers();
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
