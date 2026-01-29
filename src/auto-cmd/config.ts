import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { Config } from './types';
import { writeLog } from './log';
import { setLockPath, waitForLock, releaseLock } from './config-lock';

// 配置文件路径
let CONFIG_PATH = path.join(process.cwd(), 'local/auto-cmd-config.json');

// 设置配置文件路径
export function setConfigPath(configPath: string): void {
  CONFIG_PATH = path.resolve(configPath);
  // 设置锁文件路径
  setLockPath(CONFIG_PATH);
}

// 获取配置文件路径
export function getConfigPath(): string {
  return CONFIG_PATH;
}

// 初始化锁文件路径
setLockPath(CONFIG_PATH);

// 读取配置文件
export async function readConfig(): Promise<Config> {
  // 获取配置文件锁
  const acquired = await waitForLock();
  if (!acquired) {
    await writeLog('Failed to acquire lock for reading config file, retrying...');
    // 重试读取
    return readConfig();
  }
  
  try {
    // 检查文件是否存在且不为空
    const stats = await fs.stat(CONFIG_PATH);
    if (stats.size === 0) {
      throw new Error('Config file is empty, using default config');
    }
    
    const ext = path.extname(CONFIG_PATH).toLowerCase();
    
    let config: Config;
    if (ext === '.json') {
      // 读取JSON配置文件
      const content = await fs.readFile(CONFIG_PATH, 'utf8');
      config = JSON.parse(content);
    } else if (ext === '.yml' || ext === '.yaml') {
      // 读取YAML配置文件
      const content = await fs.readFile(CONFIG_PATH, 'utf8');
      config = yaml.parse(content) as Config;
    } else if (ext === '.js' || ext === '.mjs') {
      // 读取JS模块配置文件
      const configModule = await import(CONFIG_PATH);
      config = configModule.default || configModule;
    } else {
      throw new Error(`Unsupported config file format: ${ext}`);
    }
    
    return config;
  } catch (error) {
    // 先释放锁，避免死锁
    await releaseLock();
    
    await writeLog(`Error reading config file: ${(error as Error).message}`);
    // 如果配置文件不存在或为空，返回默认配置
    const defaultConfig: Config = {
      time: ['9:30', '12:30', '19:00', '23:00'],
      mode: 'once',
      commands: []
    };
    // 写回默认配置，防止配置文件继续为空
    await updateConfig(defaultConfig);
    return defaultConfig;
  } finally {
    // 释放锁
    await releaseLock();
  }
}

// 更新配置文件
export async function updateConfig(config: Config, executeCount: number = 0): Promise<void> {
  // 获取配置文件锁
  const acquired = await waitForLock();
  if (!acquired) {
    await writeLog('Failed to acquire lock for updating config file, retrying...');
    // 重试更新
    return updateConfig(config, executeCount);
  }
  
  try {
    const ext = path.extname(CONFIG_PATH).toLowerCase();
    
    // 确保配置文件不会被完全清空，保留基本结构
    const safeConfig = {
      ...config,
      // 确保time数组存在
      time: config.time || ['9:30', '12:30', '19:00', '23:00'],
      // 确保mode存在
      mode: config.mode || 'once',
      // 确保commands数组存在
      commands: config.commands || []
    };
    
    if (ext === '.json') {
      // 写入JSON配置文件
      const jsonContent = JSON.stringify(safeConfig, null, 2);
      // 确保写入的内容不为空
      if (jsonContent.trim() === '{}') {
        await writeLog('Warning: Attempting to write empty config, using default config instead');
        const defaultConfig: Config = {
          time: ['9:30', '12:30', '19:00', '23:00'],
          mode: 'once',
          commands: []
        };
        await fs.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
      } else {
        await fs.writeFile(CONFIG_PATH, jsonContent, 'utf8');
      }
    } else if (ext === '.yml' || ext === '.yaml') {
      // 写入YAML配置文件
      await fs.writeFile(CONFIG_PATH, yaml.stringify(safeConfig), 'utf8');
    } else if (ext === '.js' || ext === '.mjs') {
      await updateJsConfig(safeConfig, executeCount);
    } else {
      throw new Error(`Unsupported config file format for writing: ${ext}`);
    }
    
    await writeLog('Config file updated successfully');
  } catch (error) {
    await writeLog(`Error updating config file: ${(error as Error).message}`);
    throw error;
  } finally {
    // 释放锁
    await releaseLock();
  }
}

// 更新JS配置文件
export async function updateJsConfig(config: Config, executeCount: number): Promise<void> {
  // 读取当前配置文件内容
  const content = await fs.readFile(CONFIG_PATH, 'utf8');
  
  // 查找commands数组的开始位置
  const commandsRegex = /(commands:\s*\[|"commands":\s*\[)/;
  const commandsMatch = content.match(commandsRegex);
  
  if (!commandsMatch) {
    await writeLog('Warning: commands array literal not found, skipping file update');
    return;
  }
  
  if (commandsMatch.index === undefined) {
    await writeLog('Warning: Could not determine commands array position, skipping file update');
    return;
  }
  
  // 计算数组开始位置
  const arrayStart = commandsMatch.index + commandsMatch[0].length - 1; // -1 to get the '[' character
  
  // 跳过数组开始处的空格
  let i = arrayStart + 1;
  while (i < content.length && /\s/.test(content[i])) {
    i++;
  }
  
  // 如果数组为空，直接返回
  if (content[i] === ']') {
    await writeLog('Warning: commands array is empty, skipping file update');
    return;
  }
  
  // 平衡括号匹配，找到所有命令组的位置
  let balance = 0;
  let commandGroups = [];
  let currentGroupStart = i;
  let arrayEnd = -1;
  let inString = false;
  let quoteChar = '';
  let escapeNext = false;
  
  for (; i < content.length; i++) {
    const char = content[i];
    
    // 处理字符串
    if (!escapeNext && (char === '"' || char === "'")) {
      if (inString && char === quoteChar) {
        inString = false;
        quoteChar = '';
      } else if (!inString) {
        inString = true;
        quoteChar = char;
      }
      escapeNext = false;
      continue;
    }
    
    // 处理转义字符
    if (inString && char === '\\') {
      escapeNext = !escapeNext;
      continue;
    }
    
    if (!inString) {
      if (char === '{') {
        balance++;
      } else if (char === '}') {
        balance--;
        if (balance === 0) {
          // 找到一个命令组的结束位置
          commandGroups.push({ start: currentGroupStart, end: i });
          // 查找下一个命令组的开始位置
          let nextStart = i + 1;
          while (nextStart < content.length && /[,\s\n\r]/.test(content[nextStart])) {
            nextStart++;
          }
          if (nextStart < content.length && content[nextStart] === '{') {
            currentGroupStart = nextStart;
          }
        }
      } else if (char === '[') {
        balance++;
      } else if (char === ']') {
        balance--;
        if (balance === -1) {
          // 找到数组结束位置
          arrayEnd = i;
          break;
        }
      }
    }
    
    escapeNext = false;
  }
  
  if (arrayEnd === -1) {
    await writeLog('Warning: Invalid commands array structure, skipping file update');
    return;
  }
  
  // 对于once模式，删除已执行的命令组
  // 计算删除后的起始位置
  let nextItemStart = arrayStart + 1;
  // 使用传入的executeCount作为删除数量
  const removeCount = Math.min(executeCount, commandGroups.length);
  
  if (commandGroups.length > removeCount) {
    // 找到要保留的第一个命令组的开始位置
    const firstGroupToKeep = commandGroups[removeCount];
    nextItemStart = firstGroupToKeep.start;
  } else {
    // 删除所有命令组，数组变为空
    nextItemStart = arrayEnd;
  }
  
  // 构建更新后的数组内容
  const beforeArray = content.slice(0, arrayStart + 1); // 到'['字符
  const arrayContent = content.slice(nextItemStart, arrayEnd); // 剩余的命令组
  const afterArray = content.slice(arrayEnd); // 从']'到文件结束
  
  // 组合更新后的内容
  let updatedContent = '';
  if (nextItemStart < arrayEnd) {
    // 有剩余命令组
    updatedContent = beforeArray + ' ' + arrayContent + afterArray;
  } else {
    // 没有剩余命令组，数组变为空
    updatedContent = beforeArray + ' ' + afterArray;
  }
  
  // 写入更新后的内容
  await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');
}
