#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { Command } from 'commander';
import { loadConfig, DEFAULT_CONFIG_PATH, type ConnectivityWatchConfig } from './config';
import {
  buildNotification,
  evaluateTransition,
  probeTargets,
  type ProbeResult,
  type WatchState,
} from './monitor';
import { sendFeishuCard } from '../shared/notifiers/feishu';

interface CliOptions {
  config?: string;
  interval?: string;
  timeout?: string;
  stateFile?: string;
  once?: boolean;
  dryRun?: boolean;
}

function log(message: string): void {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyCliOverrides(config: ConnectivityWatchConfig, options: CliOptions): ConnectivityWatchConfig {
  const interval = options.interval ? Number(options.interval) : NaN;
  const timeout = options.timeout ? Number(options.timeout) : NaN;
  return {
    ...config,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : config.intervalSeconds,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout * 1000 : config.timeoutMs,
    stateFile: options.stateFile ? path.resolve(options.stateFile.replace(/^~(?=$|\/)/, process.env.HOME ?? '')) : config.stateFile,
  };
}

export async function readState(stateFile: string): Promise<WatchState | null> {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile, 'utf-8')) as Partial<WatchState>;
    if ((raw.status === 'up' || raw.status === 'down') && typeof raw.lastChangedAt === 'string') {
      return { status: raw.status, lastChangedAt: raw.lastChangedAt };
    }
    return null;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeState(stateFile: string, state: WatchState): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

async function sendNotification(config: ConnectivityWatchConfig, title: string, content: string, level: 'info' | 'warn'): Promise<void> {
  for (const channel of config.channels) {
    if (channel.type === 'feishu') {
      await sendFeishuCard(channel, title, content, level);
    }
  }
}

function summarize(results: ProbeResult[]): string {
  return results
    .map((result) => `${result.key}=${result.ok ? 'OK' : `ERROR:${result.error ?? result.status ?? 'unknown'}`}`)
    .join(' ');
}

export async function runOnce(config: ConnectivityWatchConfig, options: { dryRun?: boolean } = {}): Promise<WatchState> {
  const previous = await readState(config.stateFile);
  const results = await probeTargets(config.targets, { timeoutMs: config.timeoutMs });
  const transition = evaluateTransition(previous, results);
  log(summarize(results));

  if (transition.notification) {
    const message = buildNotification(transition.notification);
    if (options.dryRun) {
      log(`[dry-run] ${message.level.toUpperCase()} ${message.title}\n${message.content}`);
    } else {
      await sendNotification(config, message.title, message.content, message.level);
      log(`feishu notification sent: ${message.title}`);
    }
  }

  await writeState(config.stateFile, transition.nextState);
  return transition.nextState;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('connectivity-watch')
    .description('Monitor Google/Codex/Claude/GitHub connectivity and notify Feishu on down/recovery transitions')
    .option('-c, --config <path>', 'codex-style Feishu config yaml', DEFAULT_CONFIG_PATH)
    .option('--interval <seconds>', 'poll interval override')
    .option('--timeout <seconds>', 'per-target timeout override')
    .option('--state-file <path>', 'state file override')
    .option('--once', 'run one probe cycle and exit', false)
    .option('--dry-run', 'print notifications without sending Feishu messages', false);

  program.parse(process.argv);
  const options = program.opts<CliOptions>();
  const config = applyCliOverrides(await loadConfig(options.config), options);

  log(
    `connectivity-watch started targets=${config.targets.length} interval=${config.intervalSeconds}s timeout=${config.timeoutMs}ms state=${config.stateFile}`,
  );

  while (true) {
    try {
      await runOnce(config, { dryRun: options.dryRun });
    } catch (error: unknown) {
      logError(error instanceof Error ? error.message : String(error));
    }

    if (options.once) break;
    await sleep(config.intervalSeconds * 1000);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logError(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
