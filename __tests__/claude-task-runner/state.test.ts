import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getStateFilePath,
  loadState,
  saveTaskSuccess,
  isTaskCompleted,
} from '../../src/claude-task-runner/state';

describe('claude-task-runner/state', () => {
  let tmpDir: string;
  let taskFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-state-test-'));
    taskFilePath = path.join(tmpDir, 'tasks.yaml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getStateFilePath', () => {
    it('normal: should append .state.json to task file path', () => {
      expect(getStateFilePath('/path/to/tasks.yaml')).toBe('/path/to/tasks.yaml.state.json');
    });

    it('normal: should work with paths that have no extension', () => {
      expect(getStateFilePath('/path/to/tasks')).toBe('/path/to/tasks.state.json');
    });

    it('edge: should handle empty string', () => {
      expect(getStateFilePath('')).toBe('.state.json');
    });
  });

  describe('loadState', () => {
    it('normal: should return empty state when file does not exist', () => {
      const state = loadState(taskFilePath);
      expect(state).toEqual({ tasks: {} });
    });

    it('normal: should load existing state with completed tasks', () => {
      const stateFilePath = getStateFilePath(taskFilePath);
      const data = {
        tasks: {
          '任务A': { status: 'success', completedAt: '2026-01-01T00:00:00.000Z' },
          '任务B': { status: 'success', completedAt: '2026-01-02T00:00:00.000Z' },
        },
      };
      fs.writeFileSync(stateFilePath, JSON.stringify(data));

      const state = loadState(taskFilePath);
      expect(state.tasks['任务A'].status).toBe('success');
      expect(state.tasks['任务B'].completedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('normal: should return empty state when tasks field is missing', () => {
      const stateFilePath = getStateFilePath(taskFilePath);
      fs.writeFileSync(stateFilePath, JSON.stringify({ other: 'data' }));

      const state = loadState(taskFilePath);
      expect(state).toEqual({ tasks: {} });
    });

    it('edge: should return empty state when file contains invalid JSON', () => {
      const stateFilePath = getStateFilePath(taskFilePath);
      fs.writeFileSync(stateFilePath, 'not valid json {{');

      const state = loadState(taskFilePath);
      expect(state).toEqual({ tasks: {} });
    });

    it('edge: should return empty state when file contains a non-object', () => {
      const stateFilePath = getStateFilePath(taskFilePath);
      fs.writeFileSync(stateFilePath, JSON.stringify([1, 2, 3]));

      const state = loadState(taskFilePath);
      expect(state).toEqual({ tasks: {} });
    });
  });

  describe('saveTaskSuccess', () => {
    it('normal: should create state file and mark task as success', () => {
      saveTaskSuccess(taskFilePath, '任务A');

      const state = loadState(taskFilePath);
      expect(state.tasks['任务A'].status).toBe('success');
      expect(state.tasks['任务A'].completedAt).toBeDefined();
      expect(new Date(state.tasks['任务A'].completedAt).toISOString()).toBe(
        state.tasks['任务A'].completedAt
      );
    });

    it('normal: should append new task without overwriting existing ones', () => {
      saveTaskSuccess(taskFilePath, '任务A');
      saveTaskSuccess(taskFilePath, '任务B');

      const state = loadState(taskFilePath);
      expect(Object.keys(state.tasks)).toHaveLength(2);
      expect(state.tasks['任务A'].status).toBe('success');
      expect(state.tasks['任务B'].status).toBe('success');
    });

    it('normal: should overwrite the same task with a new timestamp', () => {
      saveTaskSuccess(taskFilePath, '任务A');
      const firstState = loadState(taskFilePath);
      const firstTime = firstState.tasks['任务A'].completedAt;

      // Small delay to get a different timestamp
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.now() + 5000));
      saveTaskSuccess(taskFilePath, '任务A');
      jest.useRealTimers();

      const secondState = loadState(taskFilePath);
      expect(secondState.tasks['任务A'].completedAt).not.toBe(firstTime);
    });

    it('edge: should handle task names with special characters', () => {
      saveTaskSuccess(taskFilePath, '任务 #1: 测试/验证');

      const state = loadState(taskFilePath);
      expect(state.tasks['任务 #1: 测试/验证'].status).toBe('success');
    });
  });

  describe('isTaskCompleted', () => {
    it('normal: should return true for a task with success status', () => {
      const state = {
        tasks: {
          '任务A': { status: 'success' as const, completedAt: '2026-01-01T00:00:00.000Z' },
        },
      };
      expect(isTaskCompleted(state, '任务A')).toBe(true);
    });

    it('normal: should return false for a task not in state', () => {
      const state = { tasks: {} };
      expect(isTaskCompleted(state, '任务A')).toBe(false);
    });

    it('normal: should return false when state has other tasks but not the queried one', () => {
      const state = {
        tasks: {
          '任务B': { status: 'success' as const, completedAt: '2026-01-01T00:00:00.000Z' },
        },
      };
      expect(isTaskCompleted(state, '任务A')).toBe(false);
    });

    it('edge: should return false for empty state', () => {
      const state = { tasks: {} };
      expect(isTaskCompleted(state, '')).toBe(false);
    });
  });
});
