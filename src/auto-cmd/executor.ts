import { exec } from 'child_process';
import { promisify } from 'util';
import { Config, CommandGroup } from './types';
import { updateConfig } from './config';

const execAsync = promisify(exec);

// 执行单个命令
export async function executeCommand(cmd: string, cwd: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return true;
  } catch {
    return false;
  }
}

// 执行命令组
export async function executeCommandGroup(group: CommandGroup, wait?: number | string): Promise<boolean> {
  const { path: cwd, cmds } = group;

  // 解析wait参数
  const { min, max } = parseWait(wait);

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    const success = await executeCommand(cmd, cwd);
    if (!success) {
      return false;
    }

    // 如果还有下一条命令，则等待
    if (i < cmds.length - 1 && (min > 0 || max > 0)) {
      // 如果min等于max，使用固定等待时间；否则随机选择
      const waitTime = min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
      await sleep(waitTime);
    }
  }

  return true;
}

// 解析count参数，返回要执行的命令数量范围
export function parseCount(count?: string): { min: number; max: number } {
  if (!count) {
    return { min: 1, max: 1 }; // 默认只执行1条
  }

  // 检查是否是范围格式 "m-n"
  if (count.includes('-')) {
    // 尝试匹配范围格式
    const rangeMatch = count.match(/^(-?\d+)-(\d+)$/);
    if (!rangeMatch) {
      return { min: 1, max: 1 };
    }

    const [, firstStr, secondStr] = rangeMatch;
    const first = Number(firstStr);
    const second = Number(secondStr);

    // 处理无效数字
    if (isNaN(first) || isNaN(second)) {
      return { min: 1, max: 1 };
    }

    // 确保min是较小的值，max是较大的值
    let min = Math.min(first, second);
    let max = Math.max(first, second);

    // 确保min至少为1
    min = Math.max(1, min);

    return {
      min: min,
      max: max
    };
  }

  // 单个数字格式 "n"
  const n = Number(count);

  // 处理无效数字
  if (isNaN(n)) {
    return { min: 1, max: 1 };
  }

  const validN = Math.max(1, n);
  return { min: validN, max: validN };
}

// 解析wait参数，返回等待时间的范围（毫秒）
export function parseWait(wait?: number | string): { min: number; max: number } {
  if (wait === undefined || wait === null) {
    return { min: 0, max: 0 }; // 默认不等待
  }

  // 数字格式
  if (typeof wait === 'number') {
    const seconds = Math.max(0, wait);
    const ms = Math.round(seconds * 1000);
    return { min: ms, max: ms };
  }

  // 字符串格式
  if (typeof wait === 'string') {
    // 检查是否是范围格式 "m-n"
    if (wait.includes('-')) {
      const rangeMatch = wait.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (!rangeMatch) {
        return { min: 0, max: 0 };
      }

      const [, minStr, maxStr] = rangeMatch;
      const min = Number(minStr);
      const max = Number(maxStr);

      if (isNaN(min) || isNaN(max) || min < 0 || max < 0) {
        return { min: 0, max: 0 };
      }

      const minMs = Math.round(Math.min(min, max) * 1000);
      const maxMs = Math.round(Math.max(min, max) * 1000);

      return { min: minMs, max: maxMs };
    }

    // 单个数字字符串格式
    const seconds = Number(wait);
    if (isNaN(seconds)) {
      return { min: 0, max: 0 };
    }

    const ms = Math.round(Math.max(0, seconds) * 1000);
    return { min: ms, max: ms };
  }

  return { min: 0, max: 0 };
}

// 等待指定时间（毫秒）
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 执行命令
export async function executeCommands(config: Config): Promise<boolean> {
  let { commands, mode, count, wait } = config;

  if (commands.length === 0) {
    return false;
  }

  // 过滤掉count为0的命令，保留有count参数但count>=1的命令
  const filteredCommands = commands.filter(cmd => cmd.count !== 0);

  if (filteredCommands.length === 0) {
    return false;
  }

  // 解析count参数
  const { min, max } = parseCount(count);

  // 随机决定要执行的命令数量
  const randomCount = Math.floor(Math.random() * (max - min + 1)) + min;
  const executeCount = Math.min(randomCount, filteredCommands.length);

  // 按顺序执行命令组
  let allSuccess = true;
  for (let i = 0; i < executeCount; i++) {
    const success = await executeCommandGroup(filteredCommands[i], wait);
    if (!success) {
      allSuccess = false;
      break;
    }
  }

  if (allSuccess) {
    // 对于once模式，处理已执行的命令组
    if (mode === 'once') {
      // 创建commands数组的副本，避免修改原始数组
      const updatedCommands = [...commands];

      // 使用filteredCommands来遍历，只处理有效的命令（count !== 0）
      let processed = 0;
      let commandIndex = 0;
      let filteredIndex = 0;

      // 遍历filteredCommands，找到对应的命令并更新
      while (processed < executeCount && filteredIndex < filteredCommands.length) {
        // 找到updatedCommands中对应的命令（通过path和cmds匹配）
        const targetCmd = filteredCommands[filteredIndex];

        // 在updatedCommands中找到匹配的命令（从commandIndex开始）
        while (commandIndex < updatedCommands.length) {
          const commandGroup = updatedCommands[commandIndex];
          if (commandGroup.path === targetCmd.path &&
              JSON.stringify(commandGroup.cmds) === JSON.stringify(targetCmd.cmds)) {
            // 找到匹配的命令
            if (commandGroup.count !== undefined) {
              if (commandGroup.count > 1) {
                commandGroup.count -= 1;
              } else {
                commandGroup.count = 0;
              }
            } else {
              // 没有count参数的命令，正常删除
              updatedCommands.splice(commandIndex, 1);
              // 不增加commandIndex，因为删除后下一个元素会移动到当前位置
            }
            break;
          }
          commandIndex++;
        }

        processed++;
        filteredIndex++;
      }

      // 更新配置文件，使用修改后的副本和执行数量
      await updateConfig({ ...config, commands: updatedCommands }, executeCount);

      return true;
    }
  }

  return false;
}
