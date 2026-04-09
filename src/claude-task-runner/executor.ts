import { spawn } from 'child_process';
import { TaskConfig, DefaultsConfig, TaskResult, ClaudeOutputJson, PermissionMode } from './types';
import { log, logError } from './log';

/**
 * 构建 Claude CLI 参数列表
 * @param task - 任务配置
 * @param defaults - 默认配置
 * @returns 参数数组
 */
export function buildArgs(task: TaskConfig, defaults: DefaultsConfig): string[] {
  const model = task.model ?? defaults.model;
  const maxBudget = task.max_budget ?? defaults.max_budget_usd;
  const permissionMode = defaults.permission_mode as PermissionMode;

  const args: string[] = [
    '-p', task.prompt,
    '--model', model,
    '--max-budget-usd', String(maxBudget),
    '--output-format', 'json',
  ];

  if (permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', permissionMode);
  }

  if (task.workdir) {
    args.push('--add-dir', task.workdir);
  }

  return args;
}

/**
 * 解析 Claude CLI 的 JSON 输出
 * @param stdout - 标准输出内容
 * @returns 解析后的结果对象
 */
export function parseClaudeOutput(stdout: string): ClaudeOutputJson {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;

    // result 可能是字符串或数组（包含 {type:'text', text:'...'} 的块）
    let result: string | undefined;
    if (typeof obj['result'] === 'string') {
      result = obj['result'];
    } else if (Array.isArray(obj['result'])) {
      const texts = (obj['result'] as Array<Record<string, unknown>>)
        .filter(b => b['type'] === 'text' && typeof b['text'] === 'string')
        .map(b => b['text'] as string);
      result = texts.join('\n');
    }

    return {
      result,
      cost_usd: typeof obj['cost_usd'] === 'number' ? obj['cost_usd'] : undefined,
      total_cost_usd: typeof obj['total_cost_usd'] === 'number' ? obj['total_cost_usd'] : undefined,
      is_error: typeof obj['is_error'] === 'boolean' ? obj['is_error'] : undefined,
      error: typeof obj['error'] === 'string' ? obj['error'] : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 截断文本到指定长度
 * @param text - 原始文本
 * @param maxLength - 最大长度
 * @returns 截断后的文本
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

/**
 * 执行单个 Claude 任务
 * @param task - 任务配置
 * @param index - 任务索引
 * @param defaults - 默认配置
 * @returns 任务执行结果
 */
export async function executeTask(
  task: TaskConfig,
  index: number,
  defaults: DefaultsConfig
): Promise<TaskResult> {
  const args = buildArgs(task, defaults);
  const timeoutMs = defaults.timeout_minutes * 60 * 1000;
  const startTime = Date.now();

  log(`[任务 #${index}] 开始执行: ${task.name}`);

  return new Promise<TaskResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const cwd = task.workdir ?? process.cwd();
    const child = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');

        // 给进程 5 秒优雅退出
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // 进程可能已退出
          }
        }, 5000);

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        logError(`[任务 #${index}] 超时: ${task.name} (${defaults.timeout_minutes} 分钟)`);

        resolve({
          index,
          name: task.name,
          status: 'timeout',
          emoji: '\u23F0',
          durationSec,
          costUsd: 0,
          exitCode: -1,
          summary: `超时 (${defaults.timeout_minutes} 分钟)`,
        });
      }
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        logError(`[任务 #${index}] 进程错误: ${error.message}`);

        resolve({
          index,
          name: task.name,
          status: 'failed',
          emoji: '\u274C',
          durationSec,
          costUsd: 0,
          exitCode: -1,
          summary: `进程错误: ${error.message}`,
        });
      }
    });

    child.on('close', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        const exitCode = code ?? -1;
        const output = parseClaudeOutput(stdout);

        if (exitCode === 0 && !output.is_error) {
          const summary = truncate(output.result ?? '(无输出)', 200);
          log(`[任务 #${index}] 完成: ${task.name} (${durationSec}s, $${(output.total_cost_usd ?? output.cost_usd ?? 0).toFixed(4)})`);

          resolve({
            index,
            name: task.name,
            status: 'success',
            emoji: '\u2705',
            durationSec,
            costUsd: output.total_cost_usd ?? output.cost_usd ?? 0,
            exitCode,
            summary,
          });
        } else {
          const errorMsg = output.error ?? stderr.trim() ?? `退出码: ${exitCode}`;
          const summary = truncate(errorMsg, 200);
          logError(`[任务 #${index}] 失败: ${task.name} - ${summary}`);

          resolve({
            index,
            name: task.name,
            status: 'failed',
            emoji: '\u274C',
            durationSec,
            costUsd: output.total_cost_usd ?? output.cost_usd ?? 0,
            exitCode,
            summary,
          });
        }
      }
    });
  });
}
