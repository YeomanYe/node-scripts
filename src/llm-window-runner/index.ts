#!/usr/bin/env node

import { Command } from 'commander';
import { DEFAULT_API_KEY_ENV as MM_DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE as MM_DEFAULT_ENV_FILE } from '../minimax-usage/env';
import { DEFAULT_API_KEY_ENV as Z_DEFAULT_API_KEY_ENV } from '../zai-usage/env';
import { DEFAULT_CONFIG_PATH, loadWindowRunnerConfig } from './config';
import { computeSlotForCli, runWindowRunnerLoop } from './loop';
import { ResolveAnchorOptions } from './windows';

interface BaseOptions {
  config: string;
  envFile: string;
  zaiApiKeyEnv: string;
  minimaxApiKeyEnv: string;
}

interface NextOptions extends BaseOptions {
  json?: boolean;
}

const stopSignal = { stopped: false };

function setupSignalHandlers(): void {
  const cleanup = (): void => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

function toResolveOpts(options: BaseOptions): ResolveAnchorOptions {
  return {
    envFile: options.envFile,
    zaiApiKeyEnv: options.zaiApiKeyEnv,
    minimaxApiKeyEnv: options.minimaxApiKeyEnv,
  };
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

async function cmdList(options: BaseOptions): Promise<void> {
  const config = await loadWindowRunnerConfig(options.config);
  const resolveOpts = toResolveOpts(options);
  const now = Date.now();
  const names = Object.keys(config.tasks).sort();
  if (names.length === 0) {
    process.stdout.write('未注册任务\n');
    return;
  }
  for (const name of names) {
    try {
      const slot = await computeSlotForCli(name, config, resolveOpts, now);
      const delta = Math.round(((slot.meta['deltaMs'] as number) ?? 0) / 1000 / 60);
      process.stdout.write(
        `${name}  trigger=${fmt(slot.triggerMs)}  fire=${fmt(slot.fireAtMs)}  Δ=${delta}min  provider=${slot.task.provider}\n`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${name}  ERROR  ${message}\n`);
    }
  }
}

async function cmdNext(name: string, options: NextOptions): Promise<void> {
  const config = await loadWindowRunnerConfig(options.config);
  const resolveOpts = toResolveOpts(options);
  const slot = await computeSlotForCli(name, config, resolveOpts);
  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          task: slot.taskName,
          provider: slot.task.provider,
          triggerMs: slot.triggerMs,
          triggerAt: new Date(slot.triggerMs).toISOString(),
          fireAtMs: slot.fireAtMs,
          fireAt: new Date(slot.fireAtMs).toISOString(),
          scheduleKey: slot.scheduleKey,
          meta: slot.meta,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }
  process.stdout.write(`task=${slot.taskName}\n`);
  process.stdout.write(`provider=${slot.task.provider}\n`);
  process.stdout.write(`trigger=${fmt(slot.triggerMs)} (${new Date(slot.triggerMs).toISOString()})\n`);
  process.stdout.write(`fire=${fmt(slot.fireAtMs)} (${new Date(slot.fireAtMs).toISOString()})\n`);
  const delta = Math.round(((slot.meta['deltaMs'] as number) ?? 0) / 1000 / 60);
  process.stdout.write(`delta=${delta}min  fallback=${Boolean(slot.meta['fallback'])}\n`);
  process.stdout.write(`window-meta=${JSON.stringify(slot.meta)}\n`);
}

async function cmdLoop(options: BaseOptions): Promise<void> {
  const config = await loadWindowRunnerConfig(options.config);
  await runWindowRunnerLoop({
    config,
    signal: stopSignal,
    ...toResolveOpts(options),
  });
}

function addBaseOptions(command: Command): Command {
  return command
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_PATH)
    .option('--env-file <path>', 'dotenv 文件 (用于 zai / minimax)', MM_DEFAULT_ENV_FILE)
    .option('--zai-api-key-env <name>', 'zai api key 环境变量名', Z_DEFAULT_API_KEY_ENV)
    .option('--minimax-api-key-env <name>', 'minimax api key 环境变量名', MM_DEFAULT_API_KEY_ENV);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('llm-window-runner')
    .description('把任务时间吸附到最近的 LLM 窗口起点执行 (minimax/zai/claude/codex)');

  addBaseOptions(program.command('list').description('列出每个任务的下一次 fire 计划'))
    .action((options: BaseOptions) => cmdList(options));

  addBaseOptions(program.command('next <task>').description('查看单任务的下一次 fire 详情'))
    .option('--json', '输出 JSON')
    .action((task: string, options: NextOptions) => cmdNext(task, options));

  addBaseOptions(program.command('loop').description('daemon：持续按窗口起点 fire 任务'))
    .action((options: BaseOptions) => cmdLoop(options));

  return program;
}

if (require.main === module) {
  setupSignalHandlers();
  createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
