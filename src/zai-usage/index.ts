#!/usr/bin/env node

import { Command } from 'commander';
import { buildNotifiers } from '../shared/notifiers';
import { DEFAULT_CONFIG_PATH, loadPollConfig } from './config';
import { DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE, readZaiApiKey } from './env';
import { formatUsageText } from './format';
import { buildPollReport, runPoll } from './poll';
import { fetchZaiUsage, DEFAULT_ZAI_HOST } from './quota';
import { ZaiUsageSnapshot } from './types';

const stopSignal = { stopped: false };

interface CliOptions {
  json?: boolean;
  notify?: boolean;
  poll?: string | true;
  config: string;
  envFile: string;
  apiKeyEnv: string;
  apiHost: string;
}

function setupSignalHandlers(): void {
  const cleanup = () => {
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

async function getSnapshot(options: CliOptions): Promise<ZaiUsageSnapshot> {
  const apiKey = await readZaiApiKey({ envFile: options.envFile, apiKeyEnv: options.apiKeyEnv });
  return fetchZaiUsage({ apiKey, apiHost: options.apiHost });
}

async function printSnapshot(options: CliOptions): Promise<void> {
  const snapshot = await getSnapshot(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return;
  }
  process.stdout.write(formatUsageText(snapshot) + '\n');
}

async function notifyOnce(options: CliOptions): Promise<void> {
  const [config, snapshot] = await Promise.all([loadPollConfig(options.config), getSnapshot(options)]);
  const report = buildPollReport(snapshot, { windows: config.alert.windows, nowMs: Date.now() });
  const notifiers = buildNotifiers(config.channels);
  const results = await Promise.allSettled(
    notifiers.map((n) => n.send({ title: report.title, content: report.content, level: report.level }))
  );
  const failed = results.map((result, index) => ({ result, index })).filter((item) => item.result.status === 'rejected');
  if (failed.length > 0) {
    const messages = failed.map((item) => {
      const reason = item.result.status === 'rejected'
        ? (item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason))
        : '';
      return `${notifiers[item.index]?.name ?? item.index}: ${reason}`;
    });
    throw new Error(`通知发送失败: ${messages.join('; ')}`);
  }
  process.stdout.write(`[${new Date().toISOString()}] ${report.summaryLine}\n`);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('zai-usage')
    .description('Display Z.ai (Zhipu) Coding Plan usage and send reports through the Feishu channel')
    .option('-p, --poll [seconds]', 'headless poll every N seconds and dispatch to channels')
    .option('--notify', 'send one usage report to configured channels')
    .option('-c, --config <path>', 'channel config path', DEFAULT_CONFIG_PATH)
    .option('--env-file <path>', 'dotenv file containing Z_API_KEY', DEFAULT_ENV_FILE)
    .option('--api-key-env <name>', 'dotenv/env key name for Z.ai API key', DEFAULT_API_KEY_ENV)
    .option('--api-host <url>', 'Z.ai API host', DEFAULT_ZAI_HOST)
    .option('--json', 'print raw normalized JSON')
    .action(async (options: CliOptions) => {
      if (options.poll !== undefined && options.notify) {
        process.stderr.write('error: --poll and --notify are mutually exclusive\n');
        process.exit(1);
      }
      if (options.poll !== undefined) {
        const config = await loadPollConfig(options.config);
        const intervalSec = options.poll === true ? config.poll.interval_seconds : parseSeconds(options.poll, 300);
        process.stdout.write(
          `[${new Date().toISOString()}] zai-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
        );
        await runPoll({ intervalSec, config, signal: stopSignal, fetcher: () => getSnapshot(options) });
        return;
      }
      if (options.notify) {
        await notifyOnce(options);
        return;
      }
      await printSnapshot(options);
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
