import fs from 'fs/promises';
import path from 'path';
import { ExecutionState } from './types';

// 获取状态文件路径
export function getStateFilePath(): string {
  return path.join(process.cwd(), 'local', 'auto-cmd-state.json');
}

// 确保状态文件目录存在
export async function ensureStateDir(): Promise<void> {
  const stateDir = path.dirname(getStateFilePath());
  try {
    await fs.access(stateDir);
  } catch {
    await fs.mkdir(stateDir, { recursive: true });
  }
}

// 读取执行状态
export async function readExecutionState(): Promise<ExecutionState> {
  await ensureStateDir();
  const statePath = getStateFilePath();
  
  try {
    const content = await fs.readFile(statePath, 'utf8');
    return JSON.parse(content);
  } catch {
    // 如果文件不存在或解析失败，返回默认状态
    return {
      lastExecutedDate: '',
      executed: false
    };
  }
}

// 写入执行状态
export async function writeExecutionState(state: ExecutionState): Promise<void> {
  await ensureStateDir();
  const statePath = getStateFilePath();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

// 获取今天的日期字符串 (YYYY-MM-DD)
export function getTodayDateString(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// 检查今天是否已经执行过
export async function isExecutedToday(): Promise<boolean> {
  const state = await readExecutionState();
  const today = getTodayDateString();
  return state.lastExecutedDate === today && state.executed;
}

// 更新执行状态为今天已执行
export async function updateExecutionState(executed: boolean): Promise<void> {
  const today = getTodayDateString();
  await writeExecutionState({ 
    lastExecutedDate: today, 
    executed 
  });
}
