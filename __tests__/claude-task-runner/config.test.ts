import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { loadRunnerConfig, loadTaskFile } from '../../src/claude-task-runner/config';

describe('claude-task-runner/config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-task-runner-test-'));
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
          model: 'opus',
          max_budget_usd: 10,
          permission_mode: 'bypassPermissions',
          timeout_minutes: 60,
          on_failure: 'stop',
        },
      };

      const filePath = path.join(tmpDir, 'config.yaml');
      await fs.writeFile(filePath, YAML.stringify(config));

      const result = await loadRunnerConfig(filePath);

      expect(result.feishu.app_id).toBe('test-app');
      expect(result.parallelism.below_30).toBe(5);
      expect(result.defaults.model).toBe('opus');
      expect(result.defaults.on_failure).toBe('stop');
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

      // feishu defaults merged
      expect(result.feishu.app_id).toBe('my-app');
      expect(result.feishu.domain).toBe('https://open.feishu.cn');
      expect(result.feishu.receive_id_type).toBe('chat_id');

      // parallelism defaults
      expect(result.parallelism.below_30).toBe(4);
      expect(result.parallelism.below_50).toBe(3);
      expect(result.parallelism.below_80).toBe(2);
      expect(result.parallelism.above_80).toBe(0);

      // defaults defaults
      expect(result.defaults.model).toBe('sonnet');
      expect(result.defaults.max_budget_usd).toBe(5);
      expect(result.defaults.permission_mode).toBe('bypassPermissions');
      expect(result.defaults.timeout_minutes).toBe(30);
      expect(result.defaults.on_failure).toBe('continue');
    });

    it('should preserve explicit parallelism rules', async () => {
      const config = {
        parallelism: {
          rules: [
            { max_usage: 25, concurrency: 5 },
            { max_usage: 75, concurrency: 2 },
          ],
        },
      };

      const filePath = path.join(tmpDir, 'rules-config.yaml');
      await fs.writeFile(filePath, YAML.stringify(config));

      const result = await loadRunnerConfig(filePath);

      expect(result.parallelism.rules).toEqual([
        { max_usage: 25, concurrency: 5 },
        { max_usage: 75, concurrency: 2 },
      ]);
      expect(result.parallelism.above_80).toBe(0);
    });

    it('should apply all defaults when config is empty object', async () => {
      const filePath = path.join(tmpDir, 'empty-config.yaml');
      await fs.writeFile(filePath, YAML.stringify({}));

      const result = await loadRunnerConfig(filePath);

      expect(result.feishu.app_id).toBe('');
      expect(result.parallelism.below_30).toBe(4);
      expect(result.defaults.model).toBe('sonnet');
    });

    it('should throw when config file does not exist', async () => {
      const filePath = path.join(tmpDir, 'nonexistent.yaml');

      await expect(loadRunnerConfig(filePath)).rejects.toThrow('不存在');
    });

    it('should throw when config file is not a valid object', async () => {
      const filePath = path.join(tmpDir, 'bad-config.yaml');
      await fs.writeFile(filePath, 'just a string');

      await expect(loadRunnerConfig(filePath)).rejects.toThrow('格式无效');
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

    it('should load tasks with optional fields', async () => {
      const taskFile = {
        tasks: [
          {
            name: 'Full Task',
            prompt: 'Do everything',
            workdir: '/tmp',
            model: 'opus',
            max_budget: 20,
            priority: 5,
            on_failure: 'stop',
          },
        ],
      };

      const filePath = path.join(tmpDir, 'full-tasks.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      const result = await loadTaskFile(filePath);

      expect(result.tasks[0].name).toBe('Full Task');
      expect(result.tasks[0].workdir).toBe('/tmp');
      expect(result.tasks[0].model).toBe('opus');
    });

    it('should throw when task file does not exist', async () => {
      const filePath = path.join(tmpDir, 'nonexistent-tasks.yaml');

      await expect(loadTaskFile(filePath)).rejects.toThrow('不存在');
    });

    it('should throw when tasks array is missing', async () => {
      const filePath = path.join(tmpDir, 'no-tasks.yaml');
      await fs.writeFile(filePath, YAML.stringify({ something: 'else' }));

      await expect(loadTaskFile(filePath)).rejects.toThrow('tasks');
    });

    it('should throw when a task is missing name', async () => {
      const taskFile = {
        tasks: [
          { prompt: 'No name here' },
        ],
      };

      const filePath = path.join(tmpDir, 'bad-task-name.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      await expect(loadTaskFile(filePath)).rejects.toThrow('name');
    });

    it('should throw when a task is missing prompt', async () => {
      const taskFile = {
        tasks: [
          { name: 'No prompt' },
        ],
      };

      const filePath = path.join(tmpDir, 'bad-task-prompt.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      await expect(loadTaskFile(filePath)).rejects.toThrow('prompt');
    });

    it('should throw when a task has empty name', async () => {
      const taskFile = {
        tasks: [
          { name: '', prompt: 'Some prompt' },
        ],
      };

      const filePath = path.join(tmpDir, 'empty-name.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      await expect(loadTaskFile(filePath)).rejects.toThrow('name');
    });

    it('should throw when a task has empty prompt', async () => {
      const taskFile = {
        tasks: [
          { name: 'Valid Name', prompt: '' },
        ],
      };

      const filePath = path.join(tmpDir, 'empty-prompt.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      await expect(loadTaskFile(filePath)).rejects.toThrow('prompt');
    });

    it('should throw when task file content is not an object', async () => {
      const filePath = path.join(tmpDir, 'string-tasks.yaml');
      await fs.writeFile(filePath, 'just a string');

      await expect(loadTaskFile(filePath)).rejects.toThrow('格式无效');
    });

    it('should validate all tasks and report correct index', async () => {
      const taskFile = {
        tasks: [
          { name: 'Good Task', prompt: 'Do good' },
          { name: '', prompt: 'Bad name at index 1' },
        ],
      };

      const filePath = path.join(tmpDir, 'index-error.yaml');
      await fs.writeFile(filePath, YAML.stringify(taskFile));

      await expect(loadTaskFile(filePath)).rejects.toThrow('#1');
    });
  });
});
