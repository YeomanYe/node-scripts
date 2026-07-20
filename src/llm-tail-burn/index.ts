#!/usr/bin/env node

import { Command } from 'commander';
import { DEFAULT_API_KEY_ENV as MM_DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE as MM_DEFAULT_ENV_FILE } from '../minimax-usage/env';
import { DEFAULT_API_KEY_ENV as Z_DEFAULT_API_KEY_ENV } from '../zai-usage/env';
import { ResolveAnchorOptions } from '../llm-window-runner/windows';
import { DEFAULT_CONFIG_PATH, loadBurnConfig } from './config';
import { computeBurnPreview, runBurnLoop } from './loop';
import { AgentDecision } from './schedule';

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

function fmtRemain(p: number | null): string {
  return p != null ? `${p.toFixed(1)}%` : '?';
}

function fmtAgent(a: AgentDecision, idx: number): string {
  const tag = a.ready ? '+' : '-';
  return `  agent[${idx}] ${a.kind}${tag} ${fmtRemain(a.remainingPercent)} end=${fmt(a.windowEndMs)} | ${a.reason}`;
}

async function cmdList(options: BaseOptions): Promise<void> {
  const config = await loadBurnConfig(options.config);
  const resolveOpts = toResolveOpts(options);
  const now = Date.now();
  const names = Object.keys(config.tasks).sort();
  if (names.length === 0) {
    process.stdout.write('未注册任务\n');
    return;
  }
  for (const name of names) {
    try {
      const { decision } = await computeBurnPreview(name, config, resolveOpts, now);
      const tag = decision.burn ? 'BURN-NOW' : 'WAIT';
      const readyCount = decision.agents.filter((a) => a.ready).length;
      process.stdout.write(
        `${name}  [${tag}]  match=${decision.match} agents=${readyCount}/${decision.agents.length}  end=${fmt(decision.windowEndMs)}\n`
      );
      for (let i = 0; i < decision.agents.length; i++) {
        process.stdout.write(fmtAgent(decision.agents[i]!, i) + '\n');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${name}  ERROR  ${message}\n`);
    }
  }
}

async function cmdNext(name: string, options: NextOptions): Promise<void> {
  const config = await loadBurnConfig(options.config);
  const resolveOpts = toResolveOpts(options);
  const { decision, agents } = await computeBurnPreview(name, config, resolveOpts);
  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          task: name,
          burn: decision.burn,
          match: decision.match,
          reason: decision.reason,
          windowEndMs: decision.windowEndMs,
          windowEndAt: new Date(decision.windowEndMs).toISOString(),
          triggerMs: decision.triggerMs,
          remainingPercent: decision.remainingPercent,
          agents: agents.map((a, i) => ({
            index: i,
            kind: a.kind,
            ready: a.ready,
            reason: a.reason,
            windowEndMs: a.windowEndMs,
            triggerMs: a.triggerMs,
            remainingPercent: a.remainingPercent,
            meta: a.meta,
          })),
        },
        null,
        2
      ) + '\n'
    );
    return;
  }
  process.stdout.write(`task=${name}\n`);
  process.stdout.write(`burn=${decision.burn} match=${decision.match}  (${decision.reason})\n`);
  process.stdout.write(`windowEnd=${fmt(decision.windowEndMs)} (${new Date(decision.windowEndMs).toISOString()})\n`);
  if (decision.triggerMs != null) {
    process.stdout.write(`trigger =${fmt(decision.triggerMs)} (${new Date(decision.triggerMs).toISOString()})\n`);
  }
  process.stdout.write(`remain  =${fmtRemain(decision.remainingPercent)}\n`);
  for (let i = 0; i < agents.length; i++) {
    process.stdout.write(fmtAgent(agents[i]!, i) + '\n');
  }
}

async function cmdLoop(options: BaseOptions): Promise<void> {
  const config = await loadBurnConfig(options.config);
  await runBurnLoop({
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
    .name('llm-tail-burn')
    .description('在 LLM 配额窗口尾部 burn 剩余额度 (minimax/zai/claude/codex，支持多 agent all/any 组合)');

  addBaseOptions(program.command('list').description('列出每个任务的 burn 计划（含每个 agent 的子决策）')).action(
    (options: BaseOptions) => cmdList(options)
  );

  addBaseOptions(program.command('next <task>').description('查看单任务的 burn 详情'))
    .option('--json', '输出 JSON')
    .action((task: string, options: NextOptions) => cmdNext(task, options));

  addBaseOptions(program.command('loop').description('daemon：持续在窗口尾部 burn 任务')).action(
    (options: BaseOptions) => cmdLoop(options)
  );

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
