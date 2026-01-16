import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { Config } from './types';
import { writeLog } from './log';

// 配置文件路径
let CONFIG_PATH = path.join(process.cwd(), 'local/auto-cmd-config.json');

// 设置配置文件路径
export function setConfigPath(configPath: string): void {
  CONFIG_PATH = path.resolve(configPath);
}

// 获取配置文件路径
export function getConfigPath(): string {
  return CONFIG_PATH;
}

// 读取配置文件
export async function readConfig(): Promise<Config> {
  try {
    const ext = path.extname(CONFIG_PATH).toLowerCase();
    
    if (ext === '.json') {
      // 读取JSON配置文件
      const content = await fs.readFile(CONFIG_PATH, 'utf8');
      return JSON.parse(content);
    } else if (ext === '.yml' || ext === '.yaml') {
      // 读取YAML配置文件
      const content = await fs.readFile(CONFIG_PATH, 'utf8');
      return yaml.parse(content) as Config;
    } else if (ext === '.js' || ext === '.mjs') {
      // 读取JS模块配置文件
      const configModule = await import(CONFIG_PATH);
      return configModule.default || configModule;
    } else {
      throw new Error(`Unsupported config file format: ${ext}`);
    }
  } catch (error) {
    await writeLog(`Error reading config file: ${(error as Error).message}`);
    throw error;
  }
}

// 更新配置文件
export async function updateConfig(config: Config): Promise<void> {
  try {
    const ext = path.extname(CONFIG_PATH).toLowerCase();
    
    if (ext === '.json') {
      await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } else if (ext === '.yml' || ext === '.yaml') {
      await fs.writeFile(CONFIG_PATH, yaml.stringify(config), 'utf8');
    } else if (ext === '.js' || ext === '.mjs') {
      await updateJsConfig(config);
    } else {
      throw new Error(`Unsupported config file format for writing: ${ext}`);
    }
    
    await writeLog('Config file updated successfully');
  } catch (error) {
    await writeLog(`Error updating config file: ${(error as Error).message}`);
    throw error;
  }
}

// 更新JS配置文件
export async function updateJsConfig(config: Config): Promise<void> {
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
  // 解析count参数，确定要删除的命令数量
  const { min, max } = parseCount(config.count);
  // 随机决定要删除的命令数量
  const randomCount = Math.floor(Math.random() * (max - min + 1)) + min;
  const removeCount = Math.min(randomCount, commandGroups.length);
  
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

// 解析count参数，返回要执行的命令数量范围
function parseCount(count?: string): { min: number; max: number } {
  if (!count) {
    return { min: 1, max: 1 }; // 默认只执行1条
  }
  
  // 检查是否是范围格式 "m-n"
  if (count.includes('-')) {
    const [min, max] = count.split('-').map(Number);
    return { 
      min: Math.max(1, min), // 最少执行1条
      max: Math.max(min, max) // 确保max >= min
    };
  }
  
  // 单个数字格式 "n"
  const n = Number(count);
  return { min: Math.max(1, n), max: Math.max(1, n) };
}
