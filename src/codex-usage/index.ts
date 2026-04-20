#!/usr/bin/env node

import { Command } from 'commander';
import { getDefaultAuthPath, loadLocalAuth } from './auth';
import { formatUsageTable } from './format';
import { getUsageSnapshot } from './usage';
import { loadPollConfig, DEFAULT_CONFIG_PATH } from './config';
import { runPoll } from './poll';

const stopSignal = { stopped: false };

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
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
  const seconds = raw === true ? defaultSec : parseInt(raw ?? '', 10);
  if (isNaN(seconds) || seconds < 1) {
    throw new Error('interval must be a positive integer');
  }
  return seconds;
}

interface CliOptions {
  json?: boolean;
  authFile: string;
  baseUrl: string;
  watch?: string | true;
  poll?: string | true;
  config?: string;
}

async function printSnapshot(options: CliOptions): Promise<void> {
  const auth = await loadLocalAuth(options.authFile);
  const snapshot = await getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    baseUrl: options.baseUrl,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return;
  }

  process.stdout.write(formatUsageTable(snapshot) + '\n');
}

async function watchUsage(intervalSeconds: number, options: CliOptions): Promise<void> {
  const run = async (): Promise<void> => {
    if (stopSignal.stopped) return;
    clearScreen();
    try {
      await printSnapshot(options);
      if (!options.json) {
        process.stdout.write(`\nRefreshing every ${intervalSeconds} seconds. Press Ctrl+C to exit.\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    }
  };

  await run();
  setInterval(() => { void run(); }, intervalSeconds * 1000);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('codex-usage')
    .description('Read Codex/ChatGPT usage data using the local ChatGPT login')
    .option('-w, --watch [seconds]', 'refresh every N seconds (default: 30)')
    .option('-p, --poll [seconds]', 'headless poll every N seconds and dispatch to channels (default: 300)')
    .option('-c, --config <path>', 'Poll config path (default: ./local/codex-usage-config.yaml)')
    .option('--json', 'print raw normalized JSON')
    .option('--auth-file <path>', 'path to auth.json', getDefaultAuthPath())
    .option('--base-url <url>', 'override usage base URL', 'https://chatgpt.com/backend-api');

  program.action(async (options: CliOptions) => {
    if (options.watch !== undefined && options.poll !== undefined) {
      process.stderr.write('error: --watch and --poll are mutually exclusive\n');
      process.exit(1);
    }

    if (options.poll !== undefined) {
      const seconds = parseSeconds(options.poll, 300);
      const configPath = options.config ?? DEFAULT_CONFIG_PATH;
      const config = await loadPollConfig(configPath);
      const intervalSec = seconds !== 300 ? seconds : config.poll.interval_seconds;
      process.stdout.write(
        `[${new Date().toISOString()}] codex-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
      );
      await runPoll({
        intervalSec,
        config,
        signal: stopSignal,
        authFile: options.authFile,
        baseUrl: options.baseUrl,
      });
      return;
    }

    if (options.watch !== undefined) {
      await watchUsage(parseSeconds(options.watch, 30), options);
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
    console.error(message);
    process.exitCode = 1;
  });
}
