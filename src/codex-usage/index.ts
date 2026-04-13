#!/usr/bin/env node

import { Command } from 'commander';
import { getDefaultAuthPath, loadLocalAuth } from './auth';
import { formatUsageTable } from './format';
import { getUsageSnapshot } from './usage';

let isShuttingDown = false;

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    process.stdout.write('\n');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

export function parseWatchInterval(watch?: string | true): number {
  const seconds = watch === true ? 30 : parseInt(watch ?? '', 10);
  if (isNaN(seconds) || seconds < 1) {
    throw new Error('watch interval must be a positive integer');
  }
  return seconds;
}

interface CliOptions {
  json?: boolean;
  authFile: string;
  baseUrl: string;
  watch?: string | true;
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
    if (isShuttingDown) return;

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

  setInterval(() => {
    void run();
  }, intervalSeconds * 1000);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('codex-usage')
    .description('Read Codex/ChatGPT usage data using the local ChatGPT login')
    .option('-w, --watch [seconds]', 'refresh every N seconds (default: 30)')
    .option('--json', 'print raw normalized JSON')
    .option('--auth-file <path>', 'path to auth.json', getDefaultAuthPath())
    .option('--base-url <url>', 'override usage base URL', 'https://chatgpt.com/backend-api');

  program.action(async (options: CliOptions) => {
    if (options.watch !== undefined) {
      await watchUsage(parseWatchInterval(options.watch), options);
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
