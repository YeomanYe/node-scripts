import { ExecCommandExecutor, ExecFileCommandExecutor, CommandExecutor, ExecuteResult } from '../src/auto-cmd/command-executor';

describe('ExecCommandExecutor', () => {
  let executor: ExecCommandExecutor;

  beforeEach(() => {
    executor = new ExecCommandExecutor();
  });

  describe('execute', () => {
    it('should execute a simple command successfully', async () => {
      const result = await executor.execute('echo "test"', '/tmp');
      expect(result.success).toBe(true);
    });

    it('should return failure for non-existent command', async () => {
      const result = await executor.execute('nonexistentcommand12345', '/tmp');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle command with special characters', async () => {
      const result = await executor.execute('echo "hello world"', '/tmp');
      expect(result.success).toBe(true);
      expect(result.stdout?.trim()).toBe('hello world');
    });

    it('should execute in specified cwd', async () => {
      const result = await executor.execute('pwd', '/tmp');
      expect(result.success).toBe(true);
      // macOS symlinks /tmp to /private/tmp
      expect(result.stdout?.trim()).toMatch(/^\/(private\/)?tmp(\/.*)?$/);
    });
  });
});

describe('ExecFileCommandExecutor', () => {
  let executor: ExecFileCommandExecutor;

  beforeEach(() => {
    executor = new ExecFileCommandExecutor();
  });

  describe('execute', () => {
    it('should execute a simple command successfully', async () => {
      const result = await executor.execute('echo test', '/tmp');
      expect(result.success).toBe(true);
    });

    it('should return failure for non-existent command', async () => {
      const result = await executor.execute('nonexistentcommand12345', '/tmp');
      expect(result.success).toBe(false);
    });

    it('should execute in specified cwd', async () => {
      const result = await executor.execute('pwd', '/tmp');
      expect(result.success).toBe(true);
      // macOS symlinks /tmp to /private/tmp
      expect(result.stdout?.trim()).toMatch(/^\/(private\/)?tmp(\/.*)?$/);
    });

    it('should handle empty command', async () => {
      const result = await executor.execute('', '/tmp');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty command');
    });
  });
});

describe('CommandExecutor interface', () => {
  it('should allow setting custom executor', () => {
    const customExecutor: CommandExecutor = {
      async execute(cmd, cwd) {
        return { success: true, stdout: `Mock: ${cmd}`, cwd };
      }
    };

    expect(customExecutor.execute('test', '/')).resolves.toEqual({
      success: true,
      stdout: 'Mock: test',
      cwd: '/'
    });
  });

  it('should return complete ExecuteResult', async () => {
    const executor = new ExecCommandExecutor();
    const result = await executor.execute('echo hello', '/tmp');

    expect(result).toHaveProperty('success');
    if (!result.success) {
      expect(result).toHaveProperty('error');
    }
  });
});
