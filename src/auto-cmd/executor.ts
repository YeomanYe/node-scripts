import { Config, CommandGroup } from './types';
import { updateConfig } from './config';
import { DEFAULT_COUNT, DEFAULT_WAIT } from './constants';
import { defaultExecutor, CommandExecutor } from './command-executor';

let executor: CommandExecutor = defaultExecutor;

export function setExecutor(exec: CommandExecutor): void {
  console.log(`[Auto-Cmd Executor] 步骤: 设置命令执行器`);
  console.log(`[Auto-Cmd Executor] 结果: 执行器已更新`);
  executor = exec;
}

export async function executeCommand(cmd: string, cwd: string): Promise<boolean> {
  console.log(`[Auto-Cmd Executor] ========== 执行单个命令 ==========`);
  console.log(`[Auto-Cmd Executor] 步骤: 调用底层执行器执行命令`);
  console.log(`[Auto-Cmd Executor] 配置信息:`);
  console.log(`[Auto-Cmd Executor]   - 命令: ${cmd}`);
  console.log(`[Auto-Cmd Executor]   - 执行目录: ${cwd}`);
  
  const result = await executor.execute(cmd, cwd);
  
  console.log(`[Auto-Cmd Executor] 结果:`);
  console.log(`[Auto-Cmd Executor]   - 执行成功: ${result.success}`);
  if (result.stdout) {
    console.log(`[Auto-Cmd Executor]   - 标准输出: ${result.stdout.substring(0, 200)}${result.stdout.length > 200 ? '...' : ''}`);
  }
  if (result.stderr) {
    console.log(`[Auto-Cmd Executor]   - 标准错误: ${result.stderr.substring(0, 200)}${result.stderr.length > 200 ? '...' : ''}`);
  }
  if (result.error) {
    console.error(`[Auto-Cmd Executor]   - 错误信息: ${result.error}`);
  }
  
  return result.success;
}

export async function executeCommandGroup(
  group: CommandGroup,
  wait?: number | string
): Promise<boolean> {
  console.log(`[Auto-Cmd Executor] ========== 执行命令组 ==========`);
  console.log(`[Auto-Cmd Executor] 步骤: 按顺序执行命令组中的所有命令`);
  console.log(`[Auto-Cmd Executor] 配置信息:`);
  console.log(`[Auto-Cmd Executor]   - 执行目录: ${group.path}`);
  console.log(`[Auto-Cmd Executor]   - 命令数量: ${group.cmds.length}`);
  console.log(`[Auto-Cmd Executor]   - 命令列表: ${JSON.stringify(group.cmds)}`);
  console.log(`[Auto-Cmd Executor]   - 等待时间: ${wait || '默认'}`);
  
  const { path: cwd, cmds } = group;

  const { min, max } = parseWait(wait);
  console.log(`[Auto-Cmd Executor] 解析等待时间: min = ${min}ms, max = ${max}ms`);

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    console.log(`[Auto-Cmd Executor] --- 执行第 ${i + 1}/${cmds.length} 条命令 ---`);
    
    const success = await executeCommand(cmd, cwd);
    if (!success) {
      console.error(`[Auto-Cmd Executor] 命令执行失败，停止执行后续命令`);
      return false;
    }

    if (i < cmds.length - 1 && (min > 0 || max > 0)) {
      const waitTime = min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
      console.log(`[Auto-Cmd Executor] 等待 ${waitTime}ms 后执行下一条命令...`);
      await sleep(waitTime);
    }
  }

  console.log(`[Auto-Cmd Executor] 结果: 命令组执行完成，全部成功`);
  return true;
}

export function parseCount(count?: string): { min: number; max: number } {
  console.log(`[Auto-Cmd Executor] 步骤: 解析 count 参数`);
  console.log(`[Auto-Cmd Executor] 配置信息: count = ${count || '未设置'}`);
  
  if (!count) {
    console.log(`[Auto-Cmd Executor] 结果: 使用默认值 ${JSON.stringify(DEFAULT_COUNT)}`);
    return DEFAULT_COUNT;
  }

  if (count.includes('-')) {
    const rangeMatch = count.match(/^(-?\d+)-(\d+)$/);
    if (!rangeMatch) {
      console.log(`[Auto-Cmd Executor] 格式不匹配，使用默认值`);
      return DEFAULT_COUNT;
    }

    const [, firstStr, secondStr] = rangeMatch;
    const first = Number(firstStr);
    const second = Number(secondStr);

    if (isNaN(first) || isNaN(second)) {
      console.log(`[Auto-Cmd Executor] 解析失败，使用默认值`);
      return DEFAULT_COUNT;
    }

    let min = Math.min(first, second);
    let max = Math.max(first, second);
    min = Math.max(1, min);

    console.log(`[Auto-Cmd Executor] 结果: min = ${min}, max = ${max}`);
    return { min, max };
  }

  const n = Number(count);
  if (isNaN(n)) {
    console.log(`[Auto-Cmd Executor] 解析失败，使用默认值`);
    return DEFAULT_COUNT;
  }

  const validN = Math.max(1, n);
  console.log(`[Auto-Cmd Executor] 结果: min = ${validN}, max = ${validN}`);
  return { min: validN, max: validN };
}

export function parseWait(wait?: number | string): { min: number; max: number } {
  if (wait === undefined || wait === null) {
    return DEFAULT_WAIT;
  }

  if (typeof wait === 'number') {
    const seconds = Math.max(0, wait);
    const ms = Math.round(seconds * 1000);
    return { min: ms, max: ms };
  }

  if (typeof wait === 'string') {
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

    const seconds = Number(wait);
    if (isNaN(seconds)) {
      return DEFAULT_WAIT;
    }

    const ms = Math.round(Math.max(0, seconds) * 1000);
    return { min: ms, max: ms };
  }

  return DEFAULT_WAIT;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCommandGroupId(group: CommandGroup): string {
  return `${group.path}::${group.cmds.join('|')}`;
}

export async function executeCommands(config: Config): Promise<boolean> {
  console.log(`[Auto-Cmd Executor] ╔══════════════════════════════════════════╗`);
  console.log(`[Auto-Cmd Executor] ║         开始执行命令配置                  ║`);
  console.log(`[Auto-Cmd Executor] ╚══════════════════════════════════════════╝`);
  console.log(`[Auto-Cmd Executor] 步骤: 根据配置执行命令`);
  
  const { commands, mode, count, wait } = config;
  console.log(`[Auto-Cmd Executor] 配置信息:`);
  console.log(`[Auto-Cmd Executor]   - mode: ${mode}`);
  console.log(`[Auto-Cmd Executor]   - count: ${count || '未设置'}`);
  console.log(`[Auto-Cmd Executor]   - wait: ${wait || '未设置'}`);
  console.log(`[Auto-Cmd Executor]   - commands数量: ${commands.length}`);

  if (commands.length === 0) {
    console.log(`[Auto-Cmd Executor] 结果: 没有配置命令，返回失败`);
    return false;
  }

  const filteredCommands = commands.filter(cmd => cmd.count !== 0);
  console.log(`[Auto-Cmd Executor] 过滤 count=0 的命令后，剩余 ${filteredCommands.length} 个命令组`);

  if (filteredCommands.length === 0) {
    console.log(`[Auto-Cmd Executor] 结果: 所有命令 count=0，返回失败`);
    return false;
  }

  const { min, max } = parseCount(count);
  const randomCount = Math.floor(Math.random() * (max - min + 1)) + min;
  const executeCount = Math.min(randomCount, filteredCommands.length);
  console.log(`[Auto-Cmd Executor] 随机决定执行数量: ${executeCount} (范围: ${min}-${max})`);

  let allSuccess = true;
  for (let i = 0; i < executeCount; i++) {
    console.log(`[Auto-Cmd Executor]`);
    console.log(`[Auto-Cmd Executor] >>> 执行第 ${i + 1}/${executeCount} 个命令组 <<<`);
    const success = await executeCommandGroup(filteredCommands[i], wait);
    if (!success) {
      allSuccess = false;
      console.error(`[Auto-Cmd Executor] 命令组 ${i + 1} 执行失败，停止后续执行`);
      break;
    }
  }

  if (allSuccess) {
    console.log(`[Auto-Cmd Executor] 所有命令组执行成功`);
    
    if (mode === 'once') {
      console.log(`[Auto-Cmd Executor] once模式，更新命令组状态...`);
      
      const executedIds = new Set(
        filteredCommands.slice(0, executeCount).map(getCommandGroupId)
      );
      console.log(`[Auto-Cmd Executor] 已执行的命令组ID: ${Array.from(executedIds).join(', ')}`);

      const updatedCommands = commands.map(group => {
        if (executedIds.has(getCommandGroupId(group))) {
          if (group.count !== undefined) {
            if (group.count > 1) {
              console.log(`[Auto-Cmd Executor] 命令组 count 减 1: ${group.count} -> ${group.count - 1}`);
              return { ...group, count: group.count - 1 };
            } else {
              console.log(`[Auto-Cmd Executor] 命令组 count 设为 0，将被过滤`);
              return { ...group, count: 0 };
            }
          }
          console.log(`[Auto-Cmd Executor] 命令组无 count 参数，将被移除`);
          return undefined;
        }
        return group;
      }).filter((cmd): cmd is CommandGroup => cmd !== undefined);

      console.log(`[Auto-Cmd Executor] 更新后的命令组数量: ${updatedCommands.length}`);
      await updateConfig({ ...config, commands: updatedCommands }, executeCount);

      console.log(`[Auto-Cmd Executor] 结果: once模式执行成功，配置已更新`);
      return true;
    }
  }

  console.log(`[Auto-Cmd Executor] 结果: ${allSuccess ? '执行成功' : '执行失败'}`);
  return false;
}
