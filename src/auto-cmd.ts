#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';

const execAsync = promisify(exec);

// 定义类型接口
interface CommandGroup {
  path: string;
  cmds: string[];
}

interface Config {
  time: string[];
  mode: 'once' | 'repeat';
  commands: CommandGroup[];
}

interface Options {
  config?: string;
  logDir?: string;
}

// 日志目录
let LOG_DIR = path.join(process.cwd(), 'logs');
// 配置文件路径
let CONFIG_PATH = path.join(process.cwd(), 'local/auto-cmd-config.json');
path.join(process.cwd(), '../config.json');

// 确保日志目录存在
async function ensureLogDir(): Promise<void> {
  try {
    await fs.access(LOG_DIR);
  } catch {
    await fs.mkdir(LOG_DIR, { recursive: true });
  }
}

// 写入日志
async function writeLog(message: string): Promise<void> {
  await ensureLogDir();
  const date = new Date();
  const logFileName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
  const logPath = path.join(LOG_DIR, logFileName);
  const logMessage = `[${date.toISOString()}] ${message}\n`;
  await fs.appendFile(logPath, logMessage, 'utf8');
  console.log(logMessage.trim());
}

// 读取配置文件
async function readConfig(): Promise<Config> {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    await writeLog(`Error reading config file: ${(error as Error).message}`);
    throw error;
  }
}

// 更新配置文件
async function updateConfig(config: Config): Promise<void> {
  try {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    await writeLog('Config file updated successfully');
  } catch (error) {
    await writeLog(`Error updating config file: ${(error as Error).message}`);
    throw error;
  }
}

// 解析时间，返回分钟数
function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// 计算当前时间的分钟数
function getCurrentTimeInMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// 计算距离下次执行的时间（毫秒）
function getNextExecutionTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
  
  for (const time of parsedTimes) {
    if (time > currentMinutes) {
      return (time - currentMinutes) * 60 * 1000;
    }
  }
  
  // 如果当天没有剩余时间，计算明天第一个时间点
  const firstTimeTomorrow = parsedTimes[0] + 24 * 60;
  return (firstTimeTomorrow - currentMinutes) * 60 * 1000;
}

// 执行单个命令
async function executeCommand(cmd: string, cwd: string): Promise<boolean> {
  try {
    await writeLog(`Executing: ${cmd} in ${cwd}`);
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    if (stdout) {
      await writeLog(`Command output: ${stdout.trim()}`);
    }
    if (stderr) {
      await writeLog(`Command error: ${stderr.trim()}`);
    }
    return true;
  } catch (error) {
    await writeLog(`Error executing command ${cmd}: ${(error as Error).message}`);
    return false;
  }
}

// 执行命令组
async function executeCommandGroup(group: CommandGroup): Promise<boolean> {
  const { path: cwd, cmds } = group;
  
  for (const cmd of cmds) {
    const success = await executeCommand(cmd, cwd);
    if (!success) {
      return false;
    }
  }
  
  return true;
}

// 执行命令
async function executeCommands(config: Config): Promise<boolean> {
  let { commands, mode } = config;
  
  if (commands.length === 0) {
    await writeLog('No commands to execute');
    return false;
  }
  
  // 执行第一个命令组
  const success = await executeCommandGroup(commands[0]);
  
  if (success) {
    await writeLog('Command group executed successfully');
    
    // 更新配置文件，删除已执行的命令
    commands.shift();
    await updateConfig({ ...config, commands });
    
    // 如果是once模式，不再执行其他命令组
    if (mode === 'once') {
      await writeLog('Mode is once, stopping execution for today');
      return true;
    }
  } else {
    await writeLog('Command group execution failed');
  }
  
  return false;
}

// 主执行函数
async function run(options: Options): Promise<void> {
  // 如果指定了自定义配置文件或日志目录，更新全局变量
  if (options.config) {
    CONFIG_PATH = path.resolve(options.config);
  }
  if (options.logDir) {
    LOG_DIR = path.resolve(options.logDir);
  }

  try {
    await writeLog('Script started');
    
    // 读取配置
    const config = await readConfig();
    const { time: targetTimes, mode } = config;
    
    // 检查是否需要立即执行
    const currentMinutes = getCurrentTimeInMinutes();
    const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
    const shouldExecuteNow = parsedTimes.includes(currentMinutes);
    
    if (shouldExecuteNow) {
      await writeLog('Current time matches target time, executing commands');
      const executed = await executeCommands(config);
      if (executed && mode === 'once') {
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
      await executeCommands(newConfig);
    }, nextExecutionTime);
    
  } catch (error) {
    await writeLog(`Unexpected error: ${(error as Error).message}`);
    process.exit(1);
  }
}

// 添加立即执行命令
async function executeNow(options: Options): Promise<void> {
  // 如果指定了自定义配置文件或日志目录，更新全局变量
  if (options.config) {
    CONFIG_PATH = path.resolve(options.config);
  }
  if (options.logDir) {
    LOG_DIR = path.resolve(options.logDir);
  }

  try {
    await writeLog('Execute now command triggered');
    const config = await readConfig();
    await executeCommands(config);
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
