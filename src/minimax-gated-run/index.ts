#!/usr/bin/env node

import { Command } from 'commander';
import { DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE, readMiniMaxApiKey } from '../minimax-usage/env';
import { fetchMiniMaxQuota } from '../minimax-usage/quota';
import { MiniMaxQuotaSnapshot } from '../minimax-usage/types';
import { DEFAULT_CONFIG_PATH, GatedRunConfig, loadGatedRunConfig, RegisteredTask } from './config';
import { evaluateMiniMaxGate, GateDecision } from './gate';
import { runRegisteredTask } from './runner';

interface BaseOptions {
  config: string;
  envFile: string;
  apiKeyEnv: string;
}

interface RunOptions extends BaseOptions {
  json?: boolean;
  failOnSkip?: boolean;
}

async function getSnapshot(options: BaseOptions): Promise<MiniMaxQuotaSnapshot> {
  const apiKey = await readMiniMaxApiKey({
    envFile: options.envFile,
    apiKeyEnv: options.apiKeyEnv,
  });
  return fetchMiniMaxQuota({ apiKey });
}

function resolveTask(config: GatedRunConfig, name: string): RegisteredTask {
  const task = config.tasks[name];
  if (!task) {
    const known = Object.keys(config.tasks).sort();
    throw new Error(`未注册任务: ${name}${known.length > 0 ? `。可用任务: ${known.join(', ')}` : ''}`);
  }
  return task;
}

function evaluateTask(config: GatedRunConfig, task: RegisteredTask, snapshot: MiniMaxQuotaSnapshot): GateDecision {
  return evaluateMiniMaxGate({
    snapshot,
    model: task.model ?? config.model,
    window: task.window ?? config.window,
    minHeadroomPercent: task.minHeadroomPercent ?? config.minHeadroomPercent,
    allowOnUnknownQuota: config.allowOnUnknownQuota,
  });
}

function printDecision(decision: GateDecision, json?: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(decision, null, 2) + '\n');
    return;
  }
  const model = decision.modelName ? ` model=${decision.modelName}` : '';
  process.stdout.write(`[minimax-gated-run]${model} window=${decision.window} ${decision.reason}\n`);
}

async function listTasks(options: BaseOptions): Promise<void> {
  const config = await loadGatedRunConfig(options.config);
  const names = Object.keys(config.tasks).sort();
  process.stdout.write(names.length > 0 ? names.join('\n') + '\n' : '未注册任务\n');
}

async function checkTask(name: string, options: RunOptions): Promise<void> {
  const [config, snapshot] = await Promise.all([
    loadGatedRunConfig(options.config),
    getSnapshot(options),
  ]);
  const task = resolveTask(config, name);
  const decision = evaluateTask(config, task, snapshot);
  printDecision(decision, options.json);
  if (!decision.allowed && options.failOnSkip) {
    process.exitCode = config.skipExitCode || 75;
  }
}

async function runTask(name: string, options: RunOptions): Promise<void> {
  const [config, snapshot] = await Promise.all([
    loadGatedRunConfig(options.config),
    getSnapshot(options),
  ]);
  const task = resolveTask(config, name);
  const decision = evaluateTask(config, task, snapshot);
  printDecision(decision, options.json);

  if (!decision.allowed) {
    process.exitCode = options.failOnSkip ? config.skipExitCode || 75 : 0;
    return;
  }

  const result = await runRegisteredTask(task);
  process.exitCode = result.code;
}

function addBaseOptions(command: Command): Command {
  return command
    .option('-c, --config <path>', 'registered task config path', DEFAULT_CONFIG_PATH)
    .option('--env-file <path>', 'dotenv file containing MINIMAX_API_KEY', DEFAULT_ENV_FILE)
    .option('--api-key-env <name>', 'dotenv/env key name for MiniMax API key', DEFAULT_API_KEY_ENV);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('minimax-gated-run')
    .description('Run registered tasks only when MiniMax linear window quota has enough headroom');

  addBaseOptions(program.command('list').description('list registered tasks'))
    .action((options: BaseOptions) => listTasks(options));

  addBaseOptions(program.command('check <task>').description('check whether a registered task would run'))
    .option('--json', 'print decision JSON')
    .option('--fail-on-skip', 'return skip_exit_code when quota gate blocks the task')
    .action((task: string, options: RunOptions) => checkTask(task, options));

  addBaseOptions(program.command('run <task>').description('run a registered task if quota gate allows it'))
    .option('--json', 'print decision JSON before running')
    .option('--fail-on-skip', 'return skip_exit_code when quota gate blocks the task')
    .action((task: string, options: RunOptions) => runTask(task, options));

  return program;
}

if (require.main === module) {
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
