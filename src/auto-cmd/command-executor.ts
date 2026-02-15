import { exec, execFile, ExecOptions } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * 命令执行结果
 */
export interface ExecuteResult {
  /** 是否执行成功 */
  success: boolean;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 命令执行器接口
 */
export interface CommandExecutor {
  /**
   * 执行命令
   * @param cmd - 要执行的命令
   * @param cwd - 执行目录
   * @returns 执行结果
   */
  execute(cmd: string, cwd: string): Promise<ExecuteResult>;
}

/**
 * 基于 child_process.exec 的执行器
 * 支持 shell 特性（管道、重定向等）
 */
export class ExecCommandExecutor implements CommandExecutor {
  private options: ExecOptions;

  constructor(options: ExecOptions = {}) {
    this.options = options;
  }

  async execute(cmd: string, cwd: string): Promise<ExecuteResult> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { ...this.options, cwd });
      return {
        success: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

/**
 * 基于 child_process.execFile 的执行器
 * 更安全，不支持 shell 特性
 */
export class ExecFileCommandExecutor implements CommandExecutor {
  private options: ExecOptions;

  constructor(options: ExecOptions = {}) {
    this.options = options;
  }

  async execute(cmd: string, cwd: string): Promise<ExecuteResult> {
    try {
      // 解析命令和参数
      const parts = this.parseCommand(cmd);
      if (parts.length === 0) {
        return { success: false, error: 'Empty command' };
      }

      const [command, ...args] = parts;
      const { stdout, stderr } = await execFileAsync(command, args, { ...this.options, cwd });
      return {
        success: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 解析命令字符串为命令和参数数组
   * @param cmd - 命令字符串
   * @returns 命令和参数数组
   */
  private parseCommand(cmd: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];

      if (char === '"' || char === "'") {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuote) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }
}

/**
 * 默认执行器实例
 */
export const defaultExecutor = new ExecCommandExecutor();
