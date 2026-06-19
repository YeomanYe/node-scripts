#!/usr/bin/env node

import { Command } from 'commander';
import { DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE } from '../minimax-usage/env';
import { fetchMiniMaxQuota } from '../minimax-usage/quota';
import { MiniMaxQuotaSnapshot } from '../minimax-usage/types';
import { DEFAULT_CONFIG_PATH, GatedRunConfig, loadGatedRunConfig, ProviderConfig, RegisteredTask, resolveProviderApiKey } from './config';
import { evaluateMiniMaxGate, GateDecision } from './gate';
import { runProviderLoops } from './loop';
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

const stopSignal = { stopped: false };

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

async function getProviderSnapshot(provider: ProviderConfig, options: BaseOptions): Promise<MiniMaxQuotaSnapshot> {
  if (provider.type === 'minimax') {
    // 每个 provider 用自己的 api key(provider.apiKey/apiKeyEnv/envFile),缺省回退全局 CLI 选项
    const apiKey = await resolveProviderApiKey(provider, {
      envFile: options.envFile,
      apiKeyEnv: options.apiKeyEnv,
    });
    return fetchMiniMaxQuota({ apiKey });
  }
  throw new Error(`未知 provider: ${(provider as { type: string }).type}`);
}

function resolveTask(config: GatedRunConfig, name: string): RegisteredTask {
  const task = config.tasks[name];
  if (!task) {
    const known = Object.keys(config.tasks).sort();
    throw new Error(`未注册任务: ${name}${known.length > 0 ? `。可用任务: ${known.join(', ')}` : ''}`);
  }
  return task;
}

interface ResolvedProvider {
  id: string;
  config: ProviderConfig;
}

function resolveProvider(config: GatedRunConfig, task: RegisteredTask): ResolvedProvider {
  const id = task.provider ?? config.defaultProvider;
  const provider = config.providers[id];
  if (!provider) throw new Error(`任务引用了未注册 provider: ${id}`);
  return { id, config: provider };
}

function evaluateTask(provider: ProviderConfig, task: RegisteredTask, snapshot: MiniMaxQuotaSnapshot): GateDecision {
  if (provider.type === 'minimax') {
    return evaluateMiniMaxGate({
      snapshot,
      model: task.model ?? provider.model,
      window: task.window ?? provider.window,
      minHeadroomPercent: task.minHeadroomPercent ?? provider.minHeadroomPercent,
      allowOnUnknownQuota: provider.allowOnUnknownQuota,
    });
  }
  throw new Error(`未知 provider: ${(provider as { type: string }).type}`);
}

function printDecision(provider: ResolvedProvider, decision: GateDecision, json?: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ provider: provider.id, providerType: provider.config.type, ...decision }, null, 2) + '\n');
    return;
  }
  const model = decision.modelName ? ` model=${decision.modelName}` : '';
  process.stdout.write(
    `[llm-gated-run] provider=${provider.id} type=${provider.config.type}${model} window=${decision.window} ${decision.reason}\n`
  );
}

async function listTasks(options: BaseOptions): Promise<void> {
  const config = await loadGatedRunConfig(options.config);
  const names = Object.keys(config.tasks).sort();
  process.stdout.write(names.length > 0 ? names.join('\n') + '\n' : '未注册任务\n');
}

async function checkTask(name: string, options: RunOptions): Promise<void> {
  const config = await loadGatedRunConfig(options.config);
  const task = resolveTask(config, name);
  const provider = resolveProvider(config, task);
  const snapshot = await getProviderSnapshot(provider.config, options);
  const decision = evaluateTask(provider.config, task, snapshot);
  printDecision(provider, decision, options.json);
  if (!decision.allowed && options.failOnSkip) {
    process.exitCode = config.skipExitCode || 75;
  }
}

async function runTask(name: string, options: RunOptions): Promise<void> {
  const config = await loadGatedRunConfig(options.config);
  const task = resolveTask(config, name);
  const provider = resolveProvider(config, task);
  const snapshot = await getProviderSnapshot(provider.config, options);
  const decision = evaluateTask(provider.config, task, snapshot);
  printDecision(provider, decision, options.json);

  if (!decision.allowed) {
    process.exitCode = options.failOnSkip ? config.skipExitCode || 75 : 0;
    return;
  }

  const result = await runRegisteredTask(task);
  process.exitCode = result.code;
}

async function loopTasks(options: BaseOptions): Promise<void> {
  const config = await loadGatedRunConfig(options.config);
  process.stdout.write(
    `[${new Date().toISOString()}] llm-gated-run loop started (providers=${Object.keys(config.providers).length})\n`
  );
  await runProviderLoops({
    config,
    envFile: options.envFile,
    apiKeyEnv: options.apiKeyEnv,
    signal: stopSignal,
  });
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
    .name('llm-gated-run')
    .description('Run registered tasks only when the LLM provider linear window quota has enough headroom');

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

  addBaseOptions(program.command('loop').description('run independent provider loops from config'))
    .action((options: BaseOptions) => loopTasks(options));

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
