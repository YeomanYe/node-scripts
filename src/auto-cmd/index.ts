#!/usr/bin/env node

import { Command } from 'commander';
import { Options, Config } from './types';
import { setConfigPath, readConfig } from './config';
import { getCurrentTimeInMinutes, parseTime, getNextExecutionTime, getNextDayFirstTime } from './time';
import { isExecutedToday, updateExecutionState } from './state';
import { executeCommands } from './executor';

// 是否正在关闭
let isShuttingDown = false;

/**
 * 设置进程信号处理
 */
function setupSignalHandlers(): void {
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down gracefully...');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

/**
 * 设置命令行选项
 * @param options - 命令行选项
 */
function setupOptions(options: Options): void {
  if (options.config) {
    setConfigPath(options.config);
  }
}

/**
 * 检查并获取执行状态
 * @param mode - 执行模式
 * @param targetTimes - 目标执行时间
 * @returns 执行状态信息
 */
async function checkExecutionStatus(
  mode: string,
  targetTimes: string[]
): Promise<{ hasExecutedToday: boolean; shouldExecuteNow: boolean }> {
  const hasExecutedToday = mode === 'once' ? await isExecutedToday() : false;

  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
  const shouldExecuteNow = parsedTimes.includes(currentMinutes);

  return { hasExecutedToday, shouldExecuteNow };
}

/**
 * 执行配置中的命令并更新状态
 * @param config - 配置对象
 * @param mode - 执行模式
 * @returns 是否执行成功
 */
async function executeAndUpdate(config: Config, mode: string): Promise<boolean> {
  const executed = await executeCommands(config);
  if (executed && mode === 'once') {
    await updateExecutionState(true);
  }
  return executed;
}

/**
 * 安排下次执行
 * @param options - 命令行选项
 * @param mode - 执行模式
 * @param configTime - 配置的时间列表
 */
function scheduleNextExecution(
  options: Options,
  mode: string,
  configTime: string[]
): void {
  const delay = mode === 'once'
    ? getNextDayFirstTime(configTime)
    : getNextExecutionTime(configTime);

  setTimeout(async () => {
    await run(options);
  }, delay);
}

/**
 * 主执行函数
 * @param options - 命令行选项
 */
export async function run(options: Options): Promise<void> {
  if (isShuttingDown) return;

  setupOptions(options);

  try {
    const config = await readConfig();
    const { time: targetTimes, mode } = config;

    // 检查执行状态
    const { hasExecutedToday, shouldExecuteNow } = await checkExecutionStatus(mode, targetTimes);

    if (mode === 'once' && hasExecutedToday) {
      const nextDayTime = getNextDayFirstTime(targetTimes);
      setTimeout(async () => {
        await run(options);
      }, nextDayTime);
      return;
    }

    if (shouldExecuteNow && !hasExecutedToday) {
      const executed = await executeAndUpdate(config, mode);

      if (executed && mode === 'once') {
        const newConfig = await readConfig();
        scheduleNextExecution(options, newConfig.mode, newConfig.time);
        return;
      }
    }

    // 设置定时器等待下次执行
    const nextExecutionTime = getNextExecutionTime(targetTimes);

    setTimeout(async () => {
      const newConfig = await readConfig();
      const { mode: newMode } = newConfig;

      const { hasExecutedToday: newHasExecuted } = await checkExecutionStatus(newMode, newConfig.time);

      if (newMode === 'once' && newHasExecuted) {
        const nextDayTime = getNextDayFirstTime(newConfig.time);
        setTimeout(async () => {
          await run(options);
        }, nextDayTime);
        return;
      }

      await executeAndUpdate(newConfig, newMode);
      scheduleNextExecution(options, newMode, newConfig.time);
    }, nextExecutionTime);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Fatal error: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * 立即执行命令
 * @param options - 命令行选项
 */
export async function executeNow(options: Options): Promise<void> {
  if (isShuttingDown) return;

  setupOptions(options);

  try {
    const config = await readConfig();
    const { time: targetTimes, mode } = config;

    const { hasExecutedToday, shouldExecuteNow } = await checkExecutionStatus(mode, targetTimes);

    if (mode === 'once' && hasExecutedToday) {
      return;
    }

    if (shouldExecuteNow && !hasExecutedToday) {
      await executeAndUpdate(config, mode);
      scheduleNextExecution(options, mode, config.time);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Execute error: ${errorMessage}`);
    process.exit(1);
  }
}

// 初始化信号处理
setupSignalHandlers();

// 初始化 Commander
const program = new Command();

program
  .name('auto-cmd')
  .description('Automated command execution scheduler')
  .version('1.0.0');

// 运行命令
program
  .command('run')
  .description('Run the command scheduler')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(run);

// 立即执行命令
program
  .command('execute')
  .description('Execute commands immediately')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(executeNow);

// 解析命令行参数
program.parse(process.argv);
