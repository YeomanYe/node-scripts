import { parseClaudeOutput, buildArgs } from '../../src/claude-task-runner/executor';
import { TaskConfig, DefaultsConfig } from '../../src/claude-task-runner/types';

describe('claude-task-runner/executor', () => {
  describe('parseClaudeOutput', () => {
    it('should parse valid JSON with result as string', () => {
      const output = JSON.stringify({
        result: 'Task completed successfully',
        cost_usd: 0.05,
        total_cost_usd: 0.12,
        is_error: false,
      });

      const result = parseClaudeOutput(output);

      expect(result.result).toBe('Task completed successfully');
      expect(result.cost_usd).toBe(0.05);
      expect(result.total_cost_usd).toBe(0.12);
      expect(result.is_error).toBe(false);
    });

    it('should parse result as array of text blocks', () => {
      const output = JSON.stringify({
        result: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
        total_cost_usd: 0.08,
      });

      const result = parseClaudeOutput(output);

      expect(result.result).toBe('First part\nSecond part');
      expect(result.total_cost_usd).toBe(0.08);
    });

    it('should filter non-text blocks from result array', () => {
      const output = JSON.stringify({
        result: [
          { type: 'text', text: 'Visible' },
          { type: 'image', data: 'base64...' },
          { type: 'text', text: 'Also visible' },
        ],
      });

      const result = parseClaudeOutput(output);

      expect(result.result).toBe('Visible\nAlso visible');
    });

    it('should return empty object for invalid JSON', () => {
      const result = parseClaudeOutput('not json at all');

      expect(result).toEqual({});
    });

    it('should return empty object for non-object JSON', () => {
      const result = parseClaudeOutput('"just a string"');

      expect(result).toEqual({});
    });

    it('should return empty object for null JSON', () => {
      const result = parseClaudeOutput('null');

      expect(result).toEqual({});
    });

    it('should handle missing optional fields', () => {
      const output = JSON.stringify({});

      const result = parseClaudeOutput(output);

      expect(result.result).toBeUndefined();
      expect(result.cost_usd).toBeUndefined();
      expect(result.total_cost_usd).toBeUndefined();
      expect(result.is_error).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should extract cost_usd when total_cost_usd is absent', () => {
      const output = JSON.stringify({
        result: 'Done',
        cost_usd: 0.03,
      });

      const result = parseClaudeOutput(output);

      expect(result.cost_usd).toBe(0.03);
      expect(result.total_cost_usd).toBeUndefined();
    });

    it('should extract total_cost_usd when both cost fields present', () => {
      const output = JSON.stringify({
        result: 'Done',
        cost_usd: 0.03,
        total_cost_usd: 0.10,
      });

      const result = parseClaudeOutput(output);

      expect(result.cost_usd).toBe(0.03);
      expect(result.total_cost_usd).toBe(0.10);
    });

    it('should extract error fields', () => {
      const output = JSON.stringify({
        is_error: true,
        error: 'Budget exceeded',
      });

      const result = parseClaudeOutput(output);

      expect(result.is_error).toBe(true);
      expect(result.error).toBe('Budget exceeded');
    });

    it('should ignore non-number cost_usd', () => {
      const output = JSON.stringify({
        cost_usd: 'not a number',
        total_cost_usd: 'also not',
      });

      const result = parseClaudeOutput(output);

      expect(result.cost_usd).toBeUndefined();
      expect(result.total_cost_usd).toBeUndefined();
    });
  });

  describe('buildArgs', () => {
    const defaultDefaults: DefaultsConfig = {
      model: 'sonnet',
      max_budget_usd: 5,
      permission_mode: 'bypassPermissions',
      timeout_minutes: 30,
      on_failure: 'continue',
    };

    it('should build basic args with defaults', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };

      const args = buildArgs(task, defaultDefaults);

      expect(args).toContain('-p');
      expect(args).toContain('Do something');
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
      expect(args).toContain('--max-budget-usd');
      expect(args).toContain('5');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
    });

    it('should add --dangerously-skip-permissions for bypassPermissions mode', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };

      const args = buildArgs(task, defaultDefaults);

      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).not.toContain('--permission-mode');
    });

    it('should add --permission-mode for non-bypass permission modes', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };
      const defaults: DefaultsConfig = {
        ...defaultDefaults,
        permission_mode: 'plan',
      };

      const args = buildArgs(task, defaults);

      expect(args).toContain('--permission-mode');
      expect(args).toContain('plan');
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('should use task model when specified', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
        model: 'opus',
      };

      const args = buildArgs(task, defaultDefaults);

      const modelIndex = args.indexOf('--model');
      expect(args[modelIndex + 1]).toBe('opus');
    });

    it('should use task max_budget when specified', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
        max_budget: 20,
      };

      const args = buildArgs(task, defaultDefaults);

      const budgetIndex = args.indexOf('--max-budget-usd');
      expect(args[budgetIndex + 1]).toBe('20');
    });

    it('should add --add-dir when workdir is specified', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
        workdir: '/home/user/project',
      };

      const args = buildArgs(task, defaultDefaults);

      expect(args).toContain('--add-dir');
      expect(args).toContain('/home/user/project');
    });

    it('should not add --add-dir when workdir is not specified', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };

      const args = buildArgs(task, defaultDefaults);

      expect(args).not.toContain('--add-dir');
    });

    it('should use default permission mode', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };
      const defaults: DefaultsConfig = {
        ...defaultDefaults,
        permission_mode: 'default',
      };

      const args = buildArgs(task, defaults);

      expect(args).toContain('--permission-mode');
      expect(args).toContain('default');
    });
  });
});
