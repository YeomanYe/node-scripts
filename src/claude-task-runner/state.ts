import * as fs from 'fs';

/** 单个任务的持久化状态 */
export interface TaskState {
  status: 'success';
  completedAt: string;
}

/** 状态文件结构 */
export interface StateFile {
  tasks: Record<string, TaskState>;
}

/**
 * 获取状态文件路径（任务文件路径 + .state.json）
 * @param taskFilePath - 任务文件路径
 */
export function getStateFilePath(taskFilePath: string): string {
  return `${taskFilePath}.state.json`;
}

/**
 * 加载状态文件，若文件不存在或格式无效则返回空状态
 * @param taskFilePath - 任务文件路径
 */
export function loadState(taskFilePath: string): StateFile {
  const stateFilePath = getStateFilePath(taskFilePath);
  try {
    const content = fs.readFileSync(stateFilePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && 'tasks' in parsed) {
      return parsed as StateFile;
    }
    return { tasks: {} };
  } catch {
    return { tasks: {} };
  }
}

/**
 * 将指定任务标记为成功并持久化到状态文件
 * @param taskFilePath - 任务文件路径
 * @param taskName - 任务名称
 */
export function saveTaskSuccess(taskFilePath: string, taskName: string): void {
  const stateFilePath = getStateFilePath(taskFilePath);
  const state = loadState(taskFilePath);
  const newState: StateFile = {
    tasks: {
      ...state.tasks,
      [taskName]: {
        status: 'success',
        completedAt: new Date().toISOString(),
      },
    },
  };
  fs.writeFileSync(stateFilePath, JSON.stringify(newState, null, 2), 'utf-8');
}

/**
 * 判断任务是否已成功完成
 * @param state - 当前状态对象
 * @param taskName - 任务名称
 */
export function isTaskCompleted(state: StateFile, taskName: string): boolean {
  return state.tasks[taskName]?.status === 'success';
}
