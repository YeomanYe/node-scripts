import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { loadRunnerConfig, loadTaskFile } from '../../src/codex-task-runner/config';

describe('codex-task-runner/config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-task-runner-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadRunnerConfig', () => {
    it('should load a valid YAML config file', async () => {
      const config = {
        feishu: {
          app_id: 'test-app',
          app_secret: 'test-secret',
          domain: 'https://open.feishu.cn',
          receive_id: 'chat123',
          receive_id_type: 'chat_id',
        },
        parallelism: {
          below_30: 5,
          below_50: 3,
          below_80: 1,
          above_80: 0,
        },
        defaults: {
          model: 'gpt-5.4',
          sandbox_mode: 'workspace-write',
          dangerously_bypass_approvals_and_sandbox: true,
          timeout_minutes: 60,
          on_failure: 'stop',
        },
      };

      const filePath = path.join(tmpDir, 'config.yaml');
      await fs.writeFile(filePath, YAML.stringify(config));

      const result = await loadRunnerConfig(filePath);

      expect(result.feishu.app_id).toBe('test-app');
      expect(result.parallelism.below_30).toBe(5);
      expect(result.defaults.model).toBe('gpt-5.4');
      expect(result.defaults.on_failure).toBe('stop');
      expect(result.defaults.dangerously_bypass_approvals_and_sandbox).toBe(true);
    });

    it('should apply default values when fields are omitted', async () => {
      const config = {
        feishu: {
          app_id: 'my-app',
        },
      };

      const filePath = path.join(tmpDir, 'partial-config.yaml');
      await fs.writeFile(filePath, YAML.stringify(config));

      const result = await loadRunnerConfig(filePath);

      expect(result.feishu.app_id).toBe('my-app');
      expect(result.feishu.domain).toBe('https://open.feishu.cn');
      expect(result.parallelism.below_30).toBe(4);
      expect(result.defaults.model).toBe('gpt-5.4');
      expect(result.defaults.sandbox_mode).toBe('workspace-write');
      expect(result.defaults.dangerously_bypass_approvals_and_sandbox).toBe(false);
      expect(result.defaults.on_failure).toBe('continue');
    });

    it('should preserve explicit parallelism rules', async () => {
      const config = {
        parallelism: {
          rules: [
            { max_usage: 10, concurrency: 4 },
            { max_usage: 70, concurrency: 1 },
          ],
        },
      };

      const filePath = path.join(tmpDir, 'rules-config.yaml');
      await fs.writeFile(filePath, YAML.stringify(config));

      const result = await loadRunnerConfig(filePath);

      expect(result.parallelism.rules).toEqual([
        { max_usage: 10, concurrency: 4 },
        { max_usage: 70, concurrency: 1 },
      ]);
      expect(result.parallelism.above_80).toBe(0);
    });
  });

  describe('loadTaskFile', () => {
    it('should load a valid task file', async () => {
      const taskFile = {
        tasks: [
          { name: 'Task 1', prompt: 'Do something', priority: 1 },
          { name: 'Task 2', prompt: 'Do another thing', priority: 2 },
        ],
      };

      const filePath = path.join(tmpDir, 'tasks.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      const result = await loadTaskFile(filePath);

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].name).toBe('Task 1');
      expect(result.tasks[1].prompt).toBe('Do another thing');
    });

    it('should throw when tasks array is missing', async () => {
      const filePath = path.join(tmpDir, 'no-tasks.yaml');
      await fs.writeFile(filePath, YAML.stringify({ something: 'else' }));

      await expect(loadTaskFile(filePath)).rejects.toThrow('tasks');
    });
  });
});
