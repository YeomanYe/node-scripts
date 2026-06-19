import { spawn } from 'child_process';
import path from 'path';
import { expandHome } from '../minimax-usage/env';
import { RegisteredTask } from './config';

export interface RunTaskResult {
  code: number;
  signal: NodeJS.Signals | null;
}

export function runRegisteredTask(task: RegisteredTask): Promise<RunTaskResult> {
  const cwd = task.cwd ? path.resolve(expandHome(task.cwd)) : process.cwd();
  const env = { ...process.env, ...task.env };
  const command = task.cmd ?? task.command;
  if (!command) throw new Error('注册任务缺少命令');

  return new Promise((resolve, reject) => {
    const child = task.cmd
      ? spawn(command, {
          cwd,
          env,
          shell: true,
          stdio: 'inherit',
        })
      : spawn(command, task.args, {
          cwd,
          env,
          shell: task.shell,
          stdio: 'inherit',
        });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}
