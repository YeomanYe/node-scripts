import { exec } from 'child_process';
import { promisify } from 'util';
import { Config, CommandGroup } from './types';
import { writeLog } from './log';
import { updateConfig } from './config';

const execAsync = promisify(exec);

// 执行单个命令
export async function executeCommand(cmd: string, cwd: string): Promise<boolean> {
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
export async function executeCommandGroup(group: CommandGroup): Promise<boolean> {
  const { path: cwd, cmds } = group;
  
  for (const cmd of cmds) {
    const success = await executeCommand(cmd, cwd);
    if (!success) {
      return false;
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

// 执行命令
export async function executeCommands(config: Config): Promise<boolean> {
  let { commands, mode, count } = config;
  
  if (commands.length === 0) {
    await writeLog('No commands to execute');
    return false;
  }
  
  // 解析count参数
  const { min, max } = parseCount(count);
  
  // 随机决定要执行的命令数量
  const randomCount = Math.floor(Math.random() * (max - min + 1)) + min;
  const executeCount = Math.min(randomCount, commands.length);
  
  await writeLog(`Randomly selected to execute ${executeCount} command groups`);
  await writeLog(`Will execute command groups 1 to ${executeCount}`);
  
  // 按顺序执行命令组
  let allSuccess = true;
  for (let i = 0; i < executeCount; i++) {
    await writeLog(`Executing command group ${i + 1}`);
    const success = await executeCommandGroup(commands[i]);
    if (!success) {
      allSuccess = false;
      break;
    }
  }
  
  if (allSuccess) {
    await writeLog('Command groups executed successfully');
    
    // 对于once模式，处理已执行的命令组
    if (mode === 'once') {
      // 创建commands数组的副本，避免修改原始数组
      const updatedCommands = [...commands];
      
      // 处理前executeCount个命令组，考虑删除后的索引变化
      let processed = 0;
      let i = 0;
      
      while (processed < executeCount && i < updatedCommands.length) {
        const commandGroup = updatedCommands[i];
        
        if (commandGroup.count && commandGroup.count > 1) {
          // 如果count大于1，减少count值，不删除命令组
          commandGroup.count -= 1;
          processed++;
          i++;
        } else {
          // 否则删除命令组
          updatedCommands.splice(i, 1);
          processed++;
          // 索引不需要增加，因为删除后下一个元素会移动到当前位置
        }
      }
      
      // 更新配置文件，使用修改后的副本
      await updateConfig({ ...config, commands: updatedCommands });
      
      await writeLog('Mode is once, stopping execution for today');
      return true;
    } else {
      // 对于repeat模式，保留所有命令组
      await writeLog('Mode is repeat, will execute same commands at next time');
    }
  } else {
    await writeLog('Command group execution failed');
  }
  
  return false;
}
