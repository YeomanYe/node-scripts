import { spawn } from 'child_process';
import { Command } from 'commander';

const CAFFEINATE = '/usr/bin/caffeinate';

interface AwakeOptions {
  display: boolean;
  idle: boolean;
  disk: boolean;
  system: boolean;
  timeout?: string;
}

function buildArgs(opts: AwakeOptions): string[] {
  const args: string[] = [];
  if (opts.display) args.push('-d');
  if (opts.idle) args.push('-i');
  if (opts.disk) args.push('-m');
  if (opts.system) args.push('-s');
  if (opts.timeout) args.push('-t', opts.timeout);
  return args;
}

function runAwake(opts: AwakeOptions): void {
  const args = buildArgs(opts);
  if (args.length === 0) {
    console.error('[boot-tasks awake] 至少需要启用一种保持唤醒模式(-d / -i / -m / -s)');
    process.exit(2);
  }

  console.log(`[boot-tasks awake] spawn ${CAFFEINATE} ${args.join(' ')}`);

  const child = spawn(CAFFEINATE, args, { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[boot-tasks awake] caffeinate exited by signal ${signal}`);
      process.exit(0);
    }
    console.log(`[boot-tasks awake] caffeinate exited with code ${code}`);
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`[boot-tasks awake] failed to spawn caffeinate:`, err);
    process.exit(1);
  });

  const forward = (sig: NodeJS.Signals) => () => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
}

export function registerAwake(program: Command): void {
  program
    .command('awake')
    .description('防止 macOS 休眠 / 屏幕变暗(caffeinate 包装,适合 pm2 长驻)')
    .option('-d, --display', '阻止显示器睡眠', true)
    .option('-i, --idle', '阻止系统 idle 睡眠', true)
    .option('-m, --disk', '阻止磁盘 idle 睡眠', true)
    .option('-s, --system', '阻止系统睡眠(仅 AC 电源时生效)', false)
    .option('-t, --timeout <seconds>', '运行指定秒数后退出(默认一直运行)')
    .option('--no-display', '不阻止显示器睡眠')
    .option('--no-idle', '不阻止系统 idle 睡眠')
    .option('--no-disk', '不阻止磁盘 idle 睡眠')
    .action((opts: AwakeOptions) => runAwake(opts));
}
