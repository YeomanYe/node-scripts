import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getStateFilePath,
  loadState,
  saveTaskSuccess,
  isTaskCompleted,
} from '../../src/codex-task-runner/state';

describe('codex-task-runner/state', () => {
  let tmpDir: string;
  let taskFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-state-test-'));
    taskFilePath = path.join(tmpDir, 'tasks.yaml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should append .state.json to task file path', () => {
    expect(getStateFilePath('/path/to/tasks.yaml')).toBe('/path/to/tasks.yaml.state.json');
  });

  it('should return empty state when file does not exist', () => {
    expect(loadState(taskFilePath)).toEqual({ tasks: {} });
  });

  it('should save completed tasks', () => {
    saveTaskSuccess(taskFilePath, 'Task A');
    const state = loadState(taskFilePath);
    expect(state.tasks['Task A'].status).toBe('success');
    expect(isTaskCompleted(state, 'Task A')).toBe(true);
  });
});
