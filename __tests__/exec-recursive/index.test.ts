import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as childProcess from 'child_process';

describe('exec-recursive', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-recursive-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createDirectoryStructure(): Promise<void> {
    await fs.mkdir(path.join(tempDir, 'a'));
    await fs.mkdir(path.join(tempDir, 'a', 'a1'));
    await fs.mkdir(path.join(tempDir, 'a', 'a2'));
    await fs.mkdir(path.join(tempDir, 'b'));
    await fs.mkdir(path.join(tempDir, 'b', 'b1'));
    await fs.mkdir(path.join(tempDir, 'c'));
  }

  describe('buildDirectoryTree', () => {
    it('should build tree with correct depth', async () => {
      await createDirectoryStructure();

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo test' -d 2 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).toContain('[depth 0]');
      expect(result).toContain('[depth 1]');
      expect(result).toContain('[depth 2]');
    });

    it('should respect depth limit', async () => {
      await createDirectoryStructure();

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo test' -d 1 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).toContain('[depth 0]');
      expect(result).toContain('[depth 1]');
      expect(result).not.toContain('[depth 2]');
    });

    it('should handle depth 0 (current directory only)', async () => {
      await createDirectoryStructure();

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo test' -d 0 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).toContain('[depth 0]');
      expect(result).not.toContain('[depth 1]');
    });
  });

  describe('execution order', () => {
    it('should execute in post-order (deepest first)', async () => {
      await createDirectoryStructure();

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'pwd' -d 2 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      const lines = result.split('\n');
      const depthOrder: number[] = [];
      
      for (const line of lines) {
        const match = line.match(/\[depth (\d+)\]/);
        if (match) {
          depthOrder.push(parseInt(match[1], 10));
        }
      }

      const maxDepth = Math.max(...depthOrder);
      const minDepth = Math.min(...depthOrder);
      
      const maxDepthIndex = depthOrder.indexOf(maxDepth);
      const minDepthIndex = depthOrder.indexOf(minDepth);
      
      expect(maxDepthIndex).toBeLessThan(minDepthIndex);
    });
  });

  describe('command execution', () => {
    it('should execute command and capture output', async () => {
      await fs.mkdir(path.join(tempDir, 'subdir'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo hello' -d 1`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).toContain('hello');
      expect(result).toContain('Success');
    });

    it('should handle command failure', async () => {
      await fs.mkdir(path.join(tempDir, 'subdir'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      
      let error: Error | null = null;
      try {
        childProcess.execSync(
          `node "${scriptPath}" 'exit 1' -d 1`,
          { cwd: tempDir, encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
    });

    it('should continue on error with -c flag', async () => {
      await fs.mkdir(path.join(tempDir, 'a'));
      await fs.mkdir(path.join(tempDir, 'b'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      
      let result = '';
      try {
        result = childProcess.execSync(
          `node "${scriptPath}" 'exit 1' -d 1 -c`,
          { cwd: tempDir, encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        result = err.stdout || err.stderr || '';
      }

      expect(result).toContain('Failed');
      expect(result).toContain('failed');
    });
  });

  describe('dry-run mode', () => {
    it('should not execute commands in dry-run mode', async () => {
      await fs.mkdir(path.join(tempDir, 'subdir'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo hello' -d 1 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).toContain('Would execute');
      expect(result).toContain('succeeded');
    });
  });

  describe('directory filtering', () => {
    it('should skip hidden directories', async () => {
      await fs.mkdir(path.join(tempDir, '.hidden'));
      await fs.mkdir(path.join(tempDir, 'visible'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo test' -d 1 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).not.toContain('.hidden');
      expect(result).toContain('visible');
    });

    it('should skip node_modules', async () => {
      await fs.mkdir(path.join(tempDir, 'node_modules'));
      await fs.mkdir(path.join(tempDir, 'src'));

      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" 'echo test' -d 1 --dry-run`,
        { cwd: tempDir, encoding: 'utf-8' }
      );

      expect(result).not.toContain('node_modules');
      expect(result).toContain('src');
    });
  });

  describe('CLI options', () => {
    it('should show help', async () => {
      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" --help`,
        { encoding: 'utf-8' }
      );

      expect(result).toContain('Execute command recursively');
      expect(result).toContain('--depth');
      expect(result).toContain('--dry-run');
    });

    it('should show version', async () => {
      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      const result = childProcess.execSync(
        `node "${scriptPath}" --version`,
        { encoding: 'utf-8' }
      );

      expect(result.trim()).toBe('1.0.0');
    });

    it('should reject invalid depth', async () => {
      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      
      let error: Error | null = null;
      try {
        childProcess.execSync(
          `node "${scriptPath}" 'echo test' -d abc`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
    });

    it('should reject negative depth', async () => {
      const scriptPath = path.resolve(__dirname, '../../dist/exec-recursive/index.js');
      
      let error: Error | null = null;
      try {
        childProcess.execSync(
          `node "${scriptPath}" 'echo test' -d -1`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
    });
  });
});
