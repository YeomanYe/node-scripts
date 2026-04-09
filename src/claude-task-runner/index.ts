#!/usr/bin/env node

import { Command } from 'commander';
import { CommandOptions } from './types';
import { loadRunnerConfig, loadTaskFile } from './config';
import { runTasks } from './runner';
import { log, logError } from './log';

/** 是否正在关闭 */
let isShuttingDown = false;

/**
 * 设置进程信号处理
 */
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

/**
 * 执行任务文件
 * @param taskFilePath - 任务文件路径
 * @param options - 命令行选项
 */
async function handleRun(taskFilePath: string, options: CommandOptions): Promise<void> {
  if (isShuttingDown) return;

  try {
    log(`加载配置文件...`);
    const config = await loadRunnerConfig(options.config);

    log(`加载任务文件: ${taskFilePath}`);
    const taskFile = await loadTaskFile(taskFilePath);

    log(`任务文件加载完成，共 ${taskFile.tasks.length} 个任务`);
    await runTasks(taskFile, config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    logError(message);
    process.exit(1);
  }
}

// 初始化信号处理
setupSignalHandlers();

// 初始化 Commander
const program = new Command();

program
  .name('claude-task-runner')
  .description('Execute Claude tasks in parallel with dynamic parallelism and Feishu notifications')
  .version('1.0.0');

// 默认命令：run
program
  .command('run <taskfile>')
  .description('Execute tasks from a YAML task file')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(handleRun);

// 解析命令行参数
program.parse(process.argv);
