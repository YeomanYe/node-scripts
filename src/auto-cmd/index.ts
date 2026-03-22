#!/usr/bin/env node

import { Command } from 'commander';
import { Options, Config } from './types';
import { setConfigPath, readConfig, getConfigPath } from './config';
import { getCurrentTimeInMinutes, parseTime, getNextExecutionTime, getNextDayFirstTime, formatTimeFromMinutes } from './time';
import { isExecutedToday, updateExecutionState, getTodayDateString, readExecutionState } from './state';
import { executeCommands } from './executor';

let isShuttingDown = false;

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[Auto-Cmd] 收到关闭信号，正在优雅退出...');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

function setupOptions(options: Options): void {
  console.log('[Auto-Cmd] ========== 初始化配置 ==========');
  console.log(`[Auto-Cmd] 步骤: 设置命令行选项`);
  console.log(`[Auto-Cmd] 配置信息: options = ${JSON.stringify(options)}`);
  
  if (options.config) {
    setConfigPath(options.config);
    console.log(`[Auto-Cmd] 结果: 使用自定义配置文件路径: ${options.config}`);
  } else {
    console.log(`[Auto-Cmd] 结果: 使用默认配置文件路径`);
  }
  console.log(`[Auto-Cmd] 最终配置文件路径: ${getConfigPath()}`);
}

async function checkExecutionStatus(
  mode: string,
  targetTimes: string[]
): Promise<{ hasExecutedToday: boolean; shouldExecuteNow: boolean }> {
  console.log(`[Auto-Cmd] ========== 检查执行状态 ==========`);
  console.log(`[Auto-Cmd] 步骤: 检查是否需要执行命令`);
  console.log(`[Auto-Cmd] 配置信息: mode = ${mode}, targetTimes = ${JSON.stringify(targetTimes)}`);
  
  const hasExecutedToday = mode === 'once' ? await isExecutedToday() : false;
  console.log(`[Auto-Cmd] 今日是否已执行 (once模式): ${hasExecutedToday}`);

  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
  const shouldExecuteNow = parsedTimes.includes(currentMinutes);
  
  console.log(`[Auto-Cmd] 当前时间: ${formatTimeFromMinutes(currentMinutes)}`);
  console.log(`[Auto-Cmd] 目标执行时间: ${targetTimes.join(', ')}`);
  console.log(`[Auto-Cmd] 当前时间是否匹配执行时间: ${shouldExecuteNow}`);
  console.log(`[Auto-Cmd] 结果: hasExecutedToday = ${hasExecutedToday}, shouldExecuteNow = ${shouldExecuteNow}`);
  
  return { hasExecutedToday, shouldExecuteNow };
}

async function executeAndUpdate(config: Config, mode: string): Promise<boolean> {
  console.log(`[Auto-Cmd] ========== 执行命令并更新状态 ==========`);
  console.log(`[Auto-Cmd] 步骤: 执行配置中的命令并更新执行状态`);
  console.log(`[Auto-Cmd] 配置信息: mode = ${mode}`);
  
  const executed = await executeCommands(config);
  console.log(`[Auto-Cmd] 命令执行结果: ${executed ? '成功' : '失败'}`);
  
  if (executed && mode === 'once') {
    console.log(`[Auto-Cmd] once模式，更新执行状态...`);
    await updateExecutionState(true);
    const state = await readExecutionState();
    console.log(`[Auto-Cmd] 状态已更新: lastExecutedDate = ${state.lastExecutedDate}, executed = ${state.executed}`);
  }
  
  console.log(`[Auto-Cmd] 结果: 返回 ${executed}`);
  return executed;
}

function scheduleNextExecution(
  options: Options,
  mode: string,
  configTime: string[]
): void {
  console.log(`[Auto-Cmd] ========== 安排下次执行 ==========`);
  console.log(`[Auto-Cmd] 步骤: 计算并安排下次执行时间`);
  console.log(`[Auto-Cmd] 配置信息: mode = ${mode}, configTime = ${JSON.stringify(configTime)}`);
  
  const delay = mode === 'once'
    ? getNextDayFirstTime(configTime)
    : getNextExecutionTime(configTime);

  const delayMinutes = Math.round(delay / 60000);
  const delayHours = Math.floor(delayMinutes / 60);
  const remainMinutes = delayMinutes % 60;
  
  console.log(`[Auto-Cmd] 延迟时间: ${delay}ms (约 ${delayHours}小时${remainMinutes}分钟)`);
  console.log(`[Auto-Cmd] 结果: 已设置定时器，等待下次执行`);

  setTimeout(async () => {
    console.log(`[Auto-Cmd] ========== 定时器触发，开始新一轮执行 ==========`);
    await run(options);
  }, delay);
}

export async function run(options: Options): Promise<void> {
  if (isShuttingDown) {
    console.log(`[Auto-Cmd] 正在关闭，跳过执行`);
    return;
  }

  console.log(`[Auto-Cmd]`);
  console.log(`[Auto-Cmd] ╔══════════════════════════════════════════╗`);
  console.log(`[Auto-Cmd] ║         Auto-Cmd 调度器启动               ║`);
  console.log(`[Auto-Cmd] ╚══════════════════════════════════════════╝`);
  console.log(`[Auto-Cmd] 当前日期: ${getTodayDateString()}`);
  console.log(`[Auto-Cmd] 当前时间: ${new Date().toLocaleTimeString('zh-CN')}`);

  setupOptions(options);

  try {
    console.log(`[Auto-Cmd] ========== 读取配置文件 ==========`);
    console.log(`[Auto-Cmd] 步骤: 从文件读取配置`);
    const config = await readConfig();
    console.log(`[Auto-Cmd] 配置读取成功:`);
    console.log(`[Auto-Cmd]   - time: ${JSON.stringify(config.time)}`);
    console.log(`[Auto-Cmd]   - mode: ${config.mode}`);
    console.log(`[Auto-Cmd]   - count: ${config.count || '未设置'}`);
    console.log(`[Auto-Cmd]   - wait: ${config.wait || '未设置'}`);
    console.log(`[Auto-Cmd]   - commands数量: ${config.commands.length}`);
    
    const { time: targetTimes, mode } = config;

    const { hasExecutedToday, shouldExecuteNow } = await checkExecutionStatus(mode, targetTimes);

    if (mode === 'once' && hasExecutedToday) {
      console.log(`[Auto-Cmd] ========== 跳过执行 (once模式今日已执行) ==========`);
      const nextDayTime = getNextDayFirstTime(targetTimes);
      const nextDayMinutes = Math.round(nextDayTime / 60000);
      console.log(`[Auto-Cmd] 结果: 等待明天首次执行时间，约 ${Math.floor(nextDayMinutes / 60)}小时${nextDayMinutes % 60}分钟后`);
      setTimeout(async () => {
        await run(options);
      }, nextDayTime);
      return;
    }

    if (shouldExecuteNow && !hasExecutedToday) {
      console.log(`[Auto-Cmd] ========== 开始执行命令 ==========`);
      console.log(`[Auto-Cmd] 触发条件: 当前时间匹配执行时间 且 今日未执行`);
      const executed = await executeAndUpdate(config, mode);

      if (executed && mode === 'once') {
        console.log(`[Auto-Cmd] once模式执行成功，重新读取配置并安排下次执行`);
        const newConfig = await readConfig();
        scheduleNextExecution(options, newConfig.mode, newConfig.time);
        return;
      }
    } else {
      console.log(`[Auto-Cmd] 当前时间不匹配执行时间，不执行命令`);
    }

    console.log(`[Auto-Cmd] ========== 设置等待定时器 ==========`);
    const nextExecutionTime = getNextExecutionTime(targetTimes);
    const nextMinutes = Math.round(nextExecutionTime / 60000);
    console.log(`[Auto-Cmd] 步骤: 计算下次执行等待时间`);
    console.log(`[Auto-Cmd] 结果: 等待 ${nextMinutes} 分钟后再次检查`);

    setTimeout(async () => {
      console.log(`[Auto-Cmd] ========== 定时检查触发 ==========`);
      const newConfig = await readConfig();
      const { mode: newMode } = newConfig;

      const { hasExecutedToday: newHasExecuted } = await checkExecutionStatus(newMode, newConfig.time);

      if (newMode === 'once' && newHasExecuted) {
        console.log(`[Auto-Cmd] once模式今日已执行，安排明天执行`);
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
    console.error(`[Auto-Cmd] ========== 发生致命错误 ==========`);
    console.error(`[Auto-Cmd] 错误信息: ${errorMessage}`);
    process.exit(1);
  }
}

export async function executeNow(options: Options): Promise<void> {
  if (isShuttingDown) return;

  console.log(`[Auto-Cmd]`);
  console.log(`[Auto-Cmd] ╔══════════════════════════════════════════╗`);
  console.log(`[Auto-Cmd] ║         Auto-Cmd 立即执行模式             ║`);
  console.log(`[Auto-Cmd] ╚══════════════════════════════════════════╝`);

  setupOptions(options);

  try {
    console.log(`[Auto-Cmd] ========== 读取配置文件 ==========`);
    const config = await readConfig();
    console.log(`[Auto-Cmd] 配置信息: mode = ${config.mode}, time = ${JSON.stringify(config.time)}`);
    
    const { time: targetTimes, mode } = config;

    const { hasExecutedToday, shouldExecuteNow } = await checkExecutionStatus(mode, targetTimes);

    if (mode === 'once' && hasExecutedToday) {
      console.log(`[Auto-Cmd] 结果: once模式今日已执行，跳过`);
      return;
    }

    if (shouldExecuteNow && !hasExecutedToday) {
      console.log(`[Auto-Cmd] ========== 开始立即执行命令 ==========`);
      await executeAndUpdate(config, mode);
      scheduleNextExecution(options, mode, config.time);
    } else {
      console.log(`[Auto-Cmd] 当前时间不匹配或已执行，不执行命令`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Auto-Cmd] ========== 执行错误 ==========`);
    console.error(`[Auto-Cmd] 错误信息: ${errorMessage}`);
    process.exit(1);
  }
}

setupSignalHandlers();

const program = new Command();

program
  .name('auto-cmd')
  .description('Automated command execution scheduler')
  .version('1.0.0');

program
  .command('run')
  .description('Run the command scheduler')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(run);

program
  .command('execute')
  .description('Execute commands immediately')
  .option('-c, --config <path>', 'Path to custom config file')
  .action(executeNow);

program.parse(process.argv);
