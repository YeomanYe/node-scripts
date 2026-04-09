#!/usr/bin/env node

import { Command } from 'commander';
import { CommandOptions } from './types';
import { getCredentials } from './credentials';
import { fetchUsage } from './api';
import { displayUsage, clearScreen } from './display';

/** 是否正在关闭 */
let isShuttingDown = false;

/**
 * 设置进程信号处理
 */
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

/**
 * 获取并显示用量信息
 * @param options - 命令行选项
 */
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

/**
 * 以监视模式定期刷新用量信息
 * @param intervalSeconds - 刷新间隔（秒）
 * @param options - 命令行选项
 */
async function watchUsage(intervalSeconds: number, options: CommandOptions): Promise<void> {
  const run = async (): Promise<void> => {
    if (isShuttingDown) return;

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

  setInterval(() => {
    void run();
  }, intervalSeconds * 1000);
}

// 初始化信号处理
setupSignalHandlers();

// 初始化 Commander
const program = new Command();

program
  .name('claude-usage')
  .description('Display Claude API usage and quota information')
  .version('1.0.0')
  .option('-w, --watch [seconds]', 'Watch mode: refresh every N seconds (default: 30)')
  .option('--json', 'Output raw JSON')
  .action(async (options: { watch?: string | true; json?: boolean }) => {
    const commandOptions: CommandOptions = {
      json: options.json ?? false,
    };

    if (options.watch !== undefined) {
      const seconds = options.watch === true ? 30 : parseInt(options.watch, 10);
      if (isNaN(seconds) || seconds < 1) {
        process.stderr.write('错误: watch 间隔必须为正整数\n');
        process.exit(1);
      }
      await watchUsage(seconds, commandOptions);
    } else {
      await showUsage(commandOptions);
    }
  });

// 解析命令行参数
program.parse(process.argv);
