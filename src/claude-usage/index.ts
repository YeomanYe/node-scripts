#!/usr/bin/env node

import { Command } from 'commander';
import { CommandOptions } from './types';
import { getCredentials } from './credentials';
import { fetchUsage } from './api';
import { displayUsage, clearScreen } from './display';
import { loadPollConfig, DEFAULT_CONFIG_PATH } from './config';
import { runPoll } from './poll';

/** 是否正在关闭 */
const stopSignal = { stopped: false };

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

async function showUsage(options: CommandOptions): Promise<void> {
  try {
    const credentials = await getCredentials();
    const usage = await fetchUsage(credentials.accessToken);

    if (options.json) {
      process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
      return;
    }

    displayUsage(usage, credentials);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    process.stderr.write(`错误: ${message}\n`);
    process.exit(1);
  }
}

async function watchUsage(intervalSeconds: number, options: CommandOptions): Promise<void> {
  const run = async (): Promise<void> => {
    if (stopSignal.stopped) return;
    clearScreen();
    try {
      const credentials = await getCredentials();
      const usage = await fetchUsage(credentials.accessToken);
      if (options.json) {
        process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
      } else {
        displayUsage(usage, credentials);
        process.stdout.write(`  每 ${intervalSeconds} 秒自动刷新，按 Ctrl+C 退出\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      process.stderr.write(`错误: ${message}\n`);
    }
  };

  await run();
  setInterval(() => { void run(); }, intervalSeconds * 1000);
}

function parseSeconds(raw: string | true, defaultSec: number): number {
  const seconds = raw === true ? defaultSec : parseInt(raw, 10);
  if (isNaN(seconds) || seconds < 1) {
    throw new Error('间隔必须为正整数');
  }
  return seconds;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('claude-usage')
    .description('Display Claude API usage and quota information')
    .version('1.0.0')
    .option('-w, --watch [seconds]', 'Watch mode: refresh every N seconds (default: 30)')
    .option('-p, --poll [seconds]', 'Headless poll mode: fetch every N seconds and dispatch to channels (default: 300)')
    .option('-c, --config <path>', 'Poll config path (default: ./local/claude-usage-config.yaml)')
    .option('--json', 'Output raw JSON')
    .action(async (options: {
      watch?: string | true;
      poll?: string | true;
      config?: string;
      json?: boolean;
    }) => {
      if (options.watch !== undefined && options.poll !== undefined) {
        process.stderr.write('错误: --watch 与 --poll 互斥\n');
        process.exit(1);
      }

      if (options.poll !== undefined) {
        try {
          const cliSecondsRaw = options.poll;
          // options.poll === true means the flag was passed with no value → use config's interval_seconds.
          // options.poll is a string → user explicitly provided seconds → use that value (even if it equals 300).
          const configPath = options.config ?? DEFAULT_CONFIG_PATH;
          const config = await loadPollConfig(configPath);
          const intervalSec = cliSecondsRaw === true
            ? config.poll.interval_seconds
            : parseSeconds(cliSecondsRaw, 300);
          process.stdout.write(
            `[${new Date().toISOString()}] claude-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
          );
          await runPoll({ intervalSec, config, signal: stopSignal });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : '未知错误';
          process.stderr.write(`错误: ${message}\n`);
          process.exit(1);
        }
        return;
      }

      const commandOptions: CommandOptions = { json: options.json ?? false };

      if (options.watch !== undefined) {
        try {
          const seconds = parseSeconds(options.watch, 30);
          await watchUsage(seconds, commandOptions);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : '未知错误';
          process.stderr.write(`错误: ${message}\n`);
          process.exit(1);
        }
        return;
      }

      await showUsage(commandOptions);
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
