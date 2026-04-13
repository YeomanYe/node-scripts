import { buildArgs, parseCodexJsonEvent, summarizeTaskOutput } from '../../src/codex-task-runner/executor';
import { DefaultsConfig, TaskConfig } from '../../src/codex-task-runner/types';

describe('codex-task-runner/executor', () => {
  describe('parseCodexJsonEvent', () => {
    it('should parse valid JSON object lines', () => {
      const parsed = parseCodexJsonEvent('{"type":"task.complete","cost_usd":0.12}');
      expect(parsed).toEqual({ type: 'task.complete', cost_usd: 0.12 });
    });

    it('should return null for invalid JSON', () => {
      expect(parseCodexJsonEvent('not-json')).toBeNull();
    });
  });

  describe('summarizeTaskOutput', () => {
    it('should prefer final message content', () => {
      expect(summarizeTaskOutput('Final answer', '')).toBe('Final answer');
    });

    it('should fall back to stderr when final message is empty', () => {
      expect(summarizeTaskOutput('', 'Something failed')).toBe('Something failed');
    });
  });

  describe('buildArgs', () => {
    const defaults: DefaultsConfig = {
      model: 'gpt-5.4',
      sandbox_mode: 'workspace-write',
      dangerously_bypass_approvals_and_sandbox: false,
      timeout_minutes: 30,
      on_failure: 'continue',
    };

    it('should build basic args with sandbox and output file', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };

      const args = buildArgs(task, defaults, '/tmp/final.txt');

      expect(args[0]).toBe('exec');
      expect(args).toContain('--ephemeral');
      expect(args).toContain('--skip-git-repo-check');
      expect(args).toContain('--color');
      expect(args).toContain('never');
      expect(args).toContain('--sandbox');
      expect(args).toContain('workspace-write');
      expect(args).toContain('-m');
      expect(args).toContain('gpt-5.4');
      expect(args).toContain('-o');
      expect(args).toContain('/tmp/final.txt');
      expect(args[args.length - 1]).toBe('Do something');
    });

    it('should allow dangerous bypass mode', () => {
      const task: TaskConfig = {
        name: 'Test Task',
        prompt: 'Do something',
      };

      const args = buildArgs(task, {
        ...defaults,
        dangerously_bypass_approvals_and_sandbox: true,
      }, '/tmp/final.txt');

      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(args).not.toContain('--sandbox');
    });
  });
});
