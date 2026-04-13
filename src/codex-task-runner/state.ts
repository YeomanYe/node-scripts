import * as fs from 'fs';

export interface TaskState {
  status: 'success';
  completedAt: string;
}

export interface StateFile {
  tasks: Record<string, TaskState>;
}

export function getStateFilePath(taskFilePath: string): string {
  return `${taskFilePath}.state.json`;
}

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

export function isTaskCompleted(state: StateFile, taskName: string): boolean {
  return state.tasks[taskName]?.status === 'success';
}
