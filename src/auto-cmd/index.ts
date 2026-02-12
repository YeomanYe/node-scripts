#!/usr/bin/env node

import { Command } from 'commander';
import { Options } from './types';
import { setConfigPath, readConfig } from './config';
import { getCurrentTimeInMinutes, parseTime, getNextExecutionTime, getNextDayFirstTime } from './time';
import { isExecutedToday, updateExecutionState } from './state';
import { executeCommands } from './executor';

// 设置选项（公共函数）
function setupOptions(options: Options): void {
  if (options.config) {
    setConfigPath(options.config);
  }
}

// 检查并获取执行状态
async function checkExecutionStatus(mode: string, targetTimes: string[]): Promise<{ hasExecutedToday: boolean; shouldExecuteNow: boolean }> {
  const hasExecutedToday = mode === 'once' ? await isExecutedToday() : false;

  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a: number, b: number) => a - b);
  const shouldExecuteNow = parsedTimes.includes(currentMinutes);

  return { hasExecutedToday, shouldExecuteNow };
}

// 安排下次执行（公共函数）
function scheduleNextExecution(options: Options, mode: string, configTime: string[]): void {
  const delay = mode === 'once'
    ? getNextDayFirstTime(configTime)
    : getNextExecutionTime(configTime);

  setTimeout(async () => {
    await run(options);
  }, delay);
}

// 主执行函数
export async function run(options: Options): Promise<void> {
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
      const executed = await executeCommands(config);

      if (executed && mode === 'once') {
        await updateExecutionState(true);
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

      const executed = await executeCommands(newConfig);

      if (executed && newMode === 'once') {
        await updateExecutionState(true);
      }

      scheduleNextExecution(options, newMode, newConfig.time);
    }, nextExecutionTime);

  } catch (error) {
    process.exit(1);
  }
}

// 立即执行命令
export async function executeNow(options: Options): Promise<void> {
  setupOptions(options);

  try {
    const config = await readConfig();
    const { time: targetTimes, mode } = config;

    const { hasExecutedToday, shouldExecuteNow } = await checkExecutionStatus(mode, targetTimes);

    if (mode === 'once' && hasExecutedToday) {
      return;
    }

    if (shouldExecuteNow && !hasExecutedToday) {
      const executed = await executeCommands(config);

      if (executed && mode === 'once') {
        await updateExecutionState(true);
      }

      scheduleNextExecution(options, mode, config.time);
    }
  } catch (error) {
    process.exit(1);
  }
}

// 初始化Commander
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
