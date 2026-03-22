import fs from 'fs/promises';
import path from 'path';
import { ExecutionState } from './types';

const STATE_FILE_NAME = 'auto-cmd-state.json';
const STATE_DIR_NAME = 'local';

export function getStateFilePath(): string {
  return path.join(process.cwd(), STATE_DIR_NAME, STATE_FILE_NAME);
}

export async function ensureStateDir(): Promise<void> {
  console.log(`[Auto-Cmd State] 步骤: 确保状态目录存在`);
  const stateDir = path.dirname(getStateFilePath());
  console.log(`[Auto-Cmd State] 配置信息: 状态目录路径 = ${stateDir}`);
  
  try {
    await fs.access(stateDir);
    console.log(`[Auto-Cmd State] 结果: 状态目录已存在`);
  } catch {
    console.log(`[Auto-Cmd State] 状态目录不存在，正在创建...`);
    await fs.mkdir(stateDir, { recursive: true });
    console.log(`[Auto-Cmd State] 结果: 状态目录创建成功`);
  }
}

export async function readExecutionState(): Promise<ExecutionState> {
  console.log(`[Auto-Cmd State] ========== 读取执行状态 ==========`);
  console.log(`[Auto-Cmd State] 步骤: 从文件读取执行状态`);
  
  await ensureStateDir();
  const statePath = getStateFilePath();
  console.log(`[Auto-Cmd State] 配置信息: 状态文件路径 = ${statePath}`);

  try {
    const content = await fs.readFile(statePath, 'utf8');
    const state = JSON.parse(content);
    console.log(`[Auto-Cmd State] 结果: 状态读取成功`);
    console.log(`[Auto-Cmd State]   - lastExecutedDate: ${state.lastExecutedDate}`);
    console.log(`[Auto-Cmd State]   - executed: ${state.executed}`);
    return state;
  } catch {
    console.log(`[Auto-Cmd State] 状态文件不存在或解析失败，返回默认状态`);
    const defaultState: ExecutionState = {
      lastExecutedDate: '',
      executed: false
    };
    console.log(`[Auto-Cmd State] 结果: 返回默认状态 = ${JSON.stringify(defaultState)}`);
    return defaultState;
  }
}

export async function writeExecutionState(state: ExecutionState): Promise<void> {
  console.log(`[Auto-Cmd State] ========== 写入执行状态 ==========`);
  console.log(`[Auto-Cmd State] 步骤: 将状态写入文件`);
  console.log(`[Auto-Cmd State] 配置信息:`);
  console.log(`[Auto-Cmd State]   - lastExecutedDate: ${state.lastExecutedDate}`);
  console.log(`[Auto-Cmd State]   - executed: ${state.executed}`);
  
  await ensureStateDir();
  const statePath = getStateFilePath();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  console.log(`[Auto-Cmd State] 结果: 状态写入成功，路径 = ${statePath}`);
}

export function getTodayDateString(): string {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dateStr;
}

export async function isExecutedToday(): Promise<boolean> {
  console.log(`[Auto-Cmd State] ========== 检查今日是否已执行 ==========`);
  console.log(`[Auto-Cmd State] 步骤: 比较状态日期与今天日期`);
  
  const state = await readExecutionState();
  const today = getTodayDateString();
  
  console.log(`[Auto-Cmd State] 配置信息:`);
  console.log(`[Auto-Cmd State]   - 状态中日期: ${state.lastExecutedDate}`);
  console.log(`[Auto-Cmd State]   - 今天日期: ${today}`);
  
  const result = state.lastExecutedDate === today && state.executed;
  console.log(`[Auto-Cmd State] 结果: 今日是否已执行 = ${result}`);
  
  return result;
}

export async function updateExecutionState(executed: boolean): Promise<void> {
  console.log(`[Auto-Cmd State] ========== 更新执行状态 ==========`);
  console.log(`[Auto-Cmd State] 步骤: 标记今天为已执行`);
  console.log(`[Auto-Cmd State] 配置信息: executed = ${executed}`);
  
  const today = getTodayDateString();
  console.log(`[Auto-Cmd State] 今天日期: ${today}`);
  
  await writeExecutionState({
    lastExecutedDate: today,
    executed
  });
  
  console.log(`[Auto-Cmd State] 结果: 执行状态已更新`);
}
