import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { DefaultsConfig, TaskConfig, TaskResult } from './types';
import { log, logError } from './log';

export function buildArgs(task: TaskConfig, defaults: DefaultsConfig, outputFile: string): string[] {
  const model = task.model ?? defaults.model;
  const args: string[] = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '-m',
    model,
    '-o',
    outputFile,
  ];

  if (defaults.dangerously_bypass_approvals_and_sandbox) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', defaults.sandbox_mode);
  }

  args.push(task.prompt);
  return args;
}

export function parseCodexJsonEvent(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function summarizeTaskOutput(finalMessage: string, stderr: string): string {
  const summary = finalMessage.trim() || stderr.trim() || '(无输出)';
  return truncate(summary, 200);
}

function extractCost(stdout: string): number {
  const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);

  for (const line of lines.reverse()) {
    const event = parseCodexJsonEvent(line);
    if (!event) continue;
    if (typeof event['total_cost_usd'] === 'number') return event['total_cost_usd'] as number;
    if (typeof event['cost_usd'] === 'number') return event['cost_usd'] as number;
  }

  return 0;
}

export async function executeTask(
  task: TaskConfig,
  index: number,
  defaults: DefaultsConfig
): Promise<TaskResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-task-runner-'));
  const outputFile = path.join(tempDir, 'last-message.txt');
  const args = buildArgs(task, defaults, outputFile);
  const timeoutMs = defaults.timeout_minutes * 60 * 1000;
  const startTime = Date.now();

  log(`[任务 #${index}] 开始执行: ${task.name}`);

  return new Promise<TaskResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const cwd = task.workdir ?? process.cwd();
    const child = spawn('codex', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cleanupAndResolve = async (result: TaskResult): Promise<void> => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');

        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // process may already be gone
          }
        }, 5000);

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        logError(`[任务 #${index}] 超时: ${task.name} (${defaults.timeout_minutes} 分钟)`);

        void cleanupAndResolve({
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
      const text = data.toString();
      if (text.includes('session id:')) {
        log(`[任务 #${index}] Codex 会话已启动`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      const text = data.toString();
      if (text.trim().length > 0 && text.includes('ERROR')) {
        logError(`[任务 #${index}] Codex STDERR: ${text.trim()}`);
      }
    });

    child.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const durationSec = Math.round((Date.now() - startTime) / 1000);
        logError(`[任务 #${index}] 进程错误: ${error.message}`);

        void cleanupAndResolve({
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

    child.on('close', async (code: number | null) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      const durationSec = Math.round((Date.now() - startTime) / 1000);
      const exitCode = code ?? -1;
      const finalMessage = await fs.readFile(outputFile, 'utf-8').catch(() => '');
      const summary = summarizeTaskOutput(finalMessage, stderr);
      const costUsd = extractCost(stdout);

      if (exitCode === 0) {
        log(`[任务 #${index}] 完成: ${task.name} (${durationSec}s, $${costUsd.toFixed(4)})`);
        await cleanupAndResolve({
          index,
          name: task.name,
          status: 'success',
          emoji: '\u2705',
          durationSec,
          costUsd,
          exitCode,
          summary,
        });
        return;
      }

      logError(`[任务 #${index}] 失败: ${task.name} - ${summary}`);
      await cleanupAndResolve({
        index,
        name: task.name,
        status: 'failed',
        emoji: '\u274C',
        durationSec,
        costUsd,
        exitCode,
        summary,
      });
    });
  });
}
