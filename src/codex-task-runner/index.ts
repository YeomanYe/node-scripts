#!/usr/bin/env node

import { Command } from 'commander';
import { CommandOptions } from './types';
import { loadRunnerConfig, loadTaskFile } from './config';
import { runTasks } from './runner';
import { log, logError } from './log';

let isShuttingDown = false;

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log('收到终止信号，正在优雅退出...');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

async function handleRun(taskFilePath: string, options: CommandOptions): Promise<void> {
  if (isShuttingDown) return;

  try {
    log('加载配置文件...');
    const config = await loadRunnerConfig(options.config);

    log(`加载任务文件: ${taskFilePath}`);
    const taskFile = await loadTaskFile(taskFilePath);

    log(`任务文件加载完成，共 ${taskFile.tasks.length} 个任务`);
    await runTasks(taskFile, config, taskFilePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    logError(message);
    process.exit(1);
  }
}

setupSignalHandlers();

const program = new Command();

program
  .name('codex-task-runner')
  .description('Execute Codex tasks in parallel with dynamic parallelism and Feishu notifications')
  .version('1.0.0');

program
  .command('run <taskfile>')
  .description('Execute tasks from a YAML task file')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(handleRun);

program.parse(process.argv);
