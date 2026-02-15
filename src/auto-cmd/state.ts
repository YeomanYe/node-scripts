import fs from 'fs/promises';
import path from 'path';
import { ExecutionState } from './types';

/** 状态文件名 */
const STATE_FILE_NAME = 'auto-cmd-state.json';

/** 状态目录名 */
const STATE_DIR_NAME = 'local';

/**
 * 获取状态文件路径
 * @returns 状态文件的完整路径
 */
export function getStateFilePath(): string {
  return path.join(process.cwd(), STATE_DIR_NAME, STATE_FILE_NAME);
}

/**
 * 确保状态文件目录存在
 */
export async function ensureStateDir(): Promise<void> {
  const stateDir = path.dirname(getStateFilePath());
  try {
    await fs.access(stateDir);
  } catch {
    await fs.mkdir(stateDir, { recursive: true });
  }
}

/**
 * 读取执行状态
 * @returns 执行状态对象，如果读取失败返回默认状态
 */
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

/**
 * 写入执行状态
 * @param state - 执行状态对象
 */
export async function writeExecutionState(state: ExecutionState): Promise<void> {
  await ensureStateDir();
  const statePath = getStateFilePath();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 获取今天的日期字符串
 * @returns YYYY-MM-DD 格式的日期字符串
 */
export function getTodayDateString(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/**
 * 检查今天是否已经执行过
 * @returns 如果今天已执行返回 true
 */
export async function isExecutedToday(): Promise<boolean> {
  const state = await readExecutionState();
  const today = getTodayDateString();
  return state.lastExecutedDate === today && state.executed;
}

/**
 * 更新执行状态为今天已执行
 * @param executed - 是否执行成功
 */
export async function updateExecutionState(executed: boolean): Promise<void> {
  const today = getTodayDateString();
  await writeExecutionState({
    lastExecutedDate: today,
    executed
  });
}
