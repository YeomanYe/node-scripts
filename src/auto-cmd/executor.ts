import { Config, CommandGroup } from './types';
import { updateConfig } from './config';
import { DEFAULT_COUNT, DEFAULT_WAIT } from './constants';
import { defaultExecutor, CommandExecutor } from './command-executor';

// 命令执行器实例
let executor: CommandExecutor = defaultExecutor;

/**
 * 设置命令执行器（用于测试和替换）
 * @param exec - 新的执行器实例
 */
export function setExecutor(exec: CommandExecutor): void {
  executor = exec;
}

/**
 * 执行单个命令
 * @param cmd - 要执行的命令
 * @param cwd - 执行目录
 * @returns 是否执行成功
 */
export async function executeCommand(cmd: string, cwd: string): Promise<boolean> {
  const result = await executor.execute(cmd, cwd);
  return result.success;
}

/**
 * 执行命令组
 * @param group - 命令组
 * @param wait - 命令间等待时间（秒或范围）
 * @returns 是否执行成功
 */
export async function executeCommandGroup(
  group: CommandGroup,
  wait?: number | string
): Promise<boolean> {
  const { path: cwd, cmds } = group;

  // 解析 wait 参数
  const { min, max } = parseWait(wait);

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    const success = await executeCommand(cmd, cwd);
    if (!success) {
      return false;
    }

    // 如果还有下一条命令，则等待
    if (i < cmds.length - 1 && (min > 0 || max > 0)) {
      const waitTime = min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
      await sleep(waitTime);
    }
  }

  return true;
}

/**
 * 解析 count 参数，返回要执行的命令数量范围
 * @param count - count 字符串，格式为 "n" 或 "m-n"
 * @returns {min, max} - 最小和最大执行数量
 */
export function parseCount(count?: string): { min: number; max: number } {
  if (!count) {
    return DEFAULT_COUNT;
  }

  // 检查是否是范围格式 "m-n"
  if (count.includes('-')) {
    const rangeMatch = count.match(/^(-?\d+)-(\d+)$/);
    if (!rangeMatch) {
      return DEFAULT_COUNT;
    }

    const [, firstStr, secondStr] = rangeMatch;
    const first = Number(firstStr);
    const second = Number(secondStr);

    if (isNaN(first) || isNaN(second)) {
      return DEFAULT_COUNT;
    }

    let min = Math.min(first, second);
    let max = Math.max(first, second);
    min = Math.max(1, min);

    return { min, max };
  }

  // 单个数字格式 "n"
  const n = Number(count);
  if (isNaN(n)) {
    return DEFAULT_COUNT;
  }

  const validN = Math.max(1, n);
  return { min: validN, max: validN };
}

/**
 * 解析 wait 参数，返回等待时间的范围（毫秒）
 * @param wait - 等待时间，数字或字符串格式
 * @returns {min, max} - 最小和最大等待时间（毫秒）
 */
export function parseWait(wait?: number | string): { min: number; max: number } {
  if (wait === undefined || wait === null) {
    return DEFAULT_WAIT;
  }

  // 数字格式（秒）
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
        return DEFAULT_WAIT;
      }

      const [, minStr, maxStr] = rangeMatch;
      const min = Number(minStr);
      const max = Number(maxStr);

      if (isNaN(min) || isNaN(max) || min < 0 || max < 0) {
        return DEFAULT_WAIT;
      }

      const minMs = Math.round(Math.min(min, max) * 1000);
      const maxMs = Math.round(Math.max(min, max) * 1000);

      return { min: minMs, max: maxMs };
    }

    // 单个数字字符串格式
    const seconds = Number(wait);
    if (isNaN(seconds)) {
      return DEFAULT_WAIT;
    }

    const ms = Math.round(Math.max(0, seconds) * 1000);
    return { min: ms, max: ms };
  }

  return DEFAULT_WAIT;
}

/**
 * 等待指定时间
 * @param ms - 等待毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成命令组的唯一标识符
 * @param group - 命令组
 * @returns 唯一标识符
 */
function getCommandGroupId(group: CommandGroup): string {
  return `${group.path}::${group.cmds.join('|')}`;
}

/**
 * 执行配置中的命令
 * @param config - 配置对象
 * @returns 是否全部执行成功
 */
export async function executeCommands(config: Config): Promise<boolean> {
  const { commands, mode, count, wait } = config;

  if (commands.length === 0) {
    return false;
  }

  // 过滤掉 count 为 0 的命令
  const filteredCommands = commands.filter(cmd => cmd.count !== 0);

  if (filteredCommands.length === 0) {
    return false;
  }

  // 解析 count 参数
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
    // 对于 once 模式，处理已执行的命令组
    if (mode === 'once') {
      // 创建命令组 ID 集合，用于快速查找
      const executedIds = new Set(
        filteredCommands.slice(0, executeCount).map(getCommandGroupId)
      );

      // 更新命令组状态
      const updatedCommands = commands.map(group => {
        if (executedIds.has(getCommandGroupId(group))) {
          if (group.count !== undefined) {
            if (group.count > 1) {
              return { ...group, count: group.count - 1 };
            } else {
              return { ...group, count: 0 };
            }
          }
          // 没有 count 参数的命令，返回 undefined 以便后续过滤
          return undefined;
        }
        return group;
      }).filter((cmd): cmd is CommandGroup => cmd !== undefined);

      // 更新配置文件
      await updateConfig({ ...config, commands: updatedCommands }, executeCount);

      return true;
    }
  }

  return false;
}
