import { exec, execFile, ExecOptions } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ExecuteResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface CommandExecutor {
  execute(cmd: string, cwd: string): Promise<ExecuteResult>;
}

export class ExecCommandExecutor implements CommandExecutor {
  private options: ExecOptions;

  constructor(options: ExecOptions = {}) {
    this.options = options;
  }

  async execute(cmd: string, cwd: string): Promise<ExecuteResult> {
    console.log(`[Auto-Cmd CmdExec] ========== ExecCommandExecutor.execute ==========`);
    console.log(`[Auto-Cmd CmdExec] 步骤: 使用 child_process.exec 执行命令`);
    console.log(`[Auto-Cmd CmdExec] 配置信息:`);
    console.log(`[Auto-Cmd CmdExec]   - 命令: ${cmd}`);
    console.log(`[Auto-Cmd CmdExec]   - 执行目录: ${cwd}`);
    console.log(`[Auto-Cmd CmdExec]   - 执行器类型: ExecCommandExecutor (支持 shell 特性)`);
    
    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(cmd, { ...this.options, cwd });
      const duration = Date.now() - startTime;
      
      console.log(`[Auto-Cmd CmdExec] 执行耗时: ${duration}ms`);
      console.log(`[Auto-Cmd CmdExec] 结果: 执行成功`);
      
      return {
        success: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString()
      };
    } catch (error) {
      console.error(`[Auto-Cmd CmdExec] 结果: 执行失败`);
      console.error(`[Auto-Cmd CmdExec] 错误: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export class ExecFileCommandExecutor implements CommandExecutor {
  private options: ExecOptions;

  constructor(options: ExecOptions = {}) {
    this.options = options;
  }

  async execute(cmd: string, cwd: string): Promise<ExecuteResult> {
    console.log(`[Auto-Cmd CmdExec] ========== ExecFileCommandExecutor.execute ==========`);
    console.log(`[Auto-Cmd CmdExec] 步骤: 使用 child_process.execFile 执行命令`);
    console.log(`[Auto-Cmd CmdExec] 配置信息:`);
    console.log(`[Auto-Cmd CmdExec]   - 命令: ${cmd}`);
    console.log(`[Auto-Cmd CmdExec]   - 执行目录: ${cwd}`);
    console.log(`[Auto-Cmd CmdExec]   - 执行器类型: ExecFileCommandExecutor (更安全，不支持 shell 特性)`);
    
    try {
      const parts = this.parseCommand(cmd);
      if (parts.length === 0) {
        console.error(`[Auto-Cmd CmdExec] 结果: 空命令，执行失败`);
        return { success: false, error: 'Empty command' };
      }

      const [command, ...args] = parts;
      console.log(`[Auto-Cmd CmdExec] 解析命令:`);
      console.log(`[Auto-Cmd CmdExec]   - 可执行文件: ${command}`);
      console.log(`[Auto-Cmd CmdExec]   - 参数: ${args.join(' ')}`);
      
      const startTime = Date.now();
      const { stdout, stderr } = await execFileAsync(command, args, { ...this.options, cwd });
      const duration = Date.now() - startTime;
      
      console.log(`[Auto-Cmd CmdExec] 执行耗时: ${duration}ms`);
      console.log(`[Auto-Cmd CmdExec] 结果: 执行成功`);
      
      return {
        success: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString()
      };
    } catch (error) {
      console.error(`[Auto-Cmd CmdExec] 结果: 执行失败`);
      console.error(`[Auto-Cmd CmdExec] 错误: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private parseCommand(cmd: string): string[] {
    console.log(`[Auto-Cmd CmdExec] 步骤: 解析命令字符串为命令和参数数组`);
    
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

    console.log(`[Auto-Cmd CmdExec] 结果: 解析出 ${parts.length} 个部分`);
    return parts;
  }
}

export const defaultExecutor = new ExecCommandExecutor();
