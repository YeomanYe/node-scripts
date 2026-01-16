#!/usr/bin/env node

import { Command } from 'commander';
import { Options } from './types';
import { setConfigPath, readConfig } from './config';
import { setLogDir, writeLog } from './log';
import { getCurrentTimeInMinutes, parseTime, getNextExecutionTime, getNextDayFirstTime } from './time';
import { isExecutedToday, updateExecutionState } from './state';
import { executeCommands } from './executor';

// 主执行函数
export async function run(options: Options): Promise<void> {
  // 如果指定了自定义配置文件或日志目录，更新全局变量
  if (options.config) {
    setConfigPath(options.config);
  }
  if (options.logDir) {
    setLogDir(options.logDir);
  }

  try {
    await writeLog('Script started');
    
    // 读取配置
    const config = await readConfig();
    const { time: targetTimes, mode } = config;
    
    // 检查今天是否已经执行过（仅对once模式有效）
    let hasExecutedToday = false;
    if (mode === 'once') {
      hasExecutedToday = await isExecutedToday();
      if (hasExecutedToday) {
        await writeLog('Once mode: already executed today, will wait for next day');
        // 直接计算明天的执行时间
        const nextDayTime = getNextDayFirstTime(targetTimes);
        await writeLog(`Next execution in ${nextDayTime / 1000 / 60} minutes`);
        setTimeout(async () => {
          await run(options);
        }, nextDayTime);
        return;
      }
    }
    
    // 检查是否需要立即执行
    const currentMinutes = getCurrentTimeInMinutes();
    const parsedTimes = targetTimes.map(parseTime).sort((a: number, b: number) => a - b);
    const shouldExecuteNow = parsedTimes.includes(currentMinutes);
    
    if (shouldExecuteNow && !hasExecutedToday) {
      await writeLog('Current time matches target time, executing commands');
      const executed = await executeCommands(config);
      if (executed && mode === 'once') {
        // 更新执行状态为已执行
        await updateExecutionState(true);
        const newConfig = await readConfig();
        const nextDayTime = getNextDayFirstTime(newConfig.time);
        setTimeout(async () => {
          await run(options);
        }, nextDayTime);
        return;
      }
    }
    
    // 计算下次执行时间
    const nextExecutionTime = getNextExecutionTime(targetTimes);
    await writeLog(`Next execution in ${nextExecutionTime / 1000 / 60} minutes`);
    
    // 设置定时器
    setTimeout(async () => {
      await writeLog('Timer triggered, executing commands');
      const newConfig = await readConfig();
      const { mode } = newConfig;
      
      // 检查今天是否已经执行过（仅对once模式有效）
      let hasExecutedToday = false;
      if (mode === 'once') {
        hasExecutedToday = await isExecutedToday();
        if (hasExecutedToday) {
          await writeLog('Once mode: already executed today, will wait for next day');
          // 直接安排明天的执行时间
          const nextDayTime = getNextDayFirstTime(newConfig.time);
          setTimeout(async () => {
            await run(options);
          }, nextDayTime);
          return;
        }
      }
      
      const executed = await executeCommands(newConfig);
      
      if (executed && mode === 'once') {
        // 更新执行状态为已执行
        await updateExecutionState(true);
      }
      
      // 递归调用run函数，继续等待下一次执行
      if (mode === 'once') {
        await writeLog('Once mode: completed, scheduling next day execution');
        // 计算明天最早的执行时间
        const nextDayTime = getNextDayFirstTime(newConfig.time);
        setTimeout(async () => {
          await run(options);
        }, nextDayTime);
      } else {
        // Repeat模式：继续等待下一个时间点的执行
        await writeLog('Repeat mode: completed, scheduling next execution');
        const nextExecutionTime = getNextExecutionTime(newConfig.time);
        setTimeout(async () => {
          await run(options);
        }, nextExecutionTime);
      }
    }, nextExecutionTime);
    
  } catch (error) {
    await writeLog(`Unexpected error: ${(error as Error).message}`);
    process.exit(1);
  }
}

// 添加立即执行命令
export async function executeNow(options: Options): Promise<void> {
  // 如果指定了自定义配置文件或日志目录，更新全局变量
  if (options.config) {
    setConfigPath(options.config);
  }
  if (options.logDir) {
    setLogDir(options.logDir);
  }

  try {
    await writeLog('Execute now command triggered');
    const config = await readConfig();
    const { time: targetTimes, mode } = config;
    
    // 检查今天是否已经执行过（仅对once模式有效）
    let hasExecutedToday = false;
    if (mode === 'once') {
      hasExecutedToday = await isExecutedToday();
      if (hasExecutedToday) {
        await writeLog('Once mode: already executed today, skipping execution');
        return;
      }
    }
    
    // 检查是否匹配配置的时间
    const currentMinutes = getCurrentTimeInMinutes();
    const parsedTimes = targetTimes.map(parseTime).sort((a: number, b: number) => a - b);
    const shouldExecuteNow = parsedTimes.includes(currentMinutes);
    
    if (shouldExecuteNow && !hasExecutedToday) {
      await writeLog('Current time matches target time, executing commands');
      const executed = await executeCommands(config);
      
      if (executed && mode === 'once') {
        // 更新执行状态为已执行
        await updateExecutionState(true);
      }
      
      // 执行后安排下一次执行时间
      await writeLog('Execute now completed, scheduling next execution');
      if (mode === 'once') {
        // Once模式：安排明天最早的执行时间
        const nextDayTime = getNextDayFirstTime(config.time);
        await writeLog(`Scheduling next day execution in ${nextDayTime / 1000 / 60} minutes`);
        setTimeout(async () => {
          await run(options);
        }, nextDayTime);
      } else {
        // Repeat模式：安排下一个执行时间
        const nextExecutionTime = getNextExecutionTime(config.time);
        await writeLog(`Scheduling next execution in ${nextExecutionTime / 1000 / 60} minutes`);
        setTimeout(async () => {
          await run(options);
        }, nextExecutionTime);
      }
    } else if (hasExecutedToday) {
      await writeLog('Once mode: already executed today, skipping execution');
    } else {
      await writeLog('Current time does not match any target time, skipping execution');
      // 显示当前时间和目标时间，方便调试
      const currentTimeStr = new Date().toLocaleTimeString();
      await writeLog(`Current time: ${currentTimeStr}`);
      await writeLog(`Target times: ${targetTimes.join(', ')}`);
    }
  } catch (error) {
    await writeLog(`Error in execute now: ${(error as Error).message}`);
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
  .option('-l, --log-dir <path>', 'Path to custom log directory')
  .action(run);

// 立即执行命令
program
  .command('execute')
  .description('Execute commands immediately')
  .option('-c, --config <path>', 'Path to custom config file')
  .option('-l, --log-dir <path>', 'Path to custom log directory')
  .action(executeNow);

// 解析命令行参数
program.parse(process.argv);
