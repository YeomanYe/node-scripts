import { Command } from 'commander';
import { notifyServeEnd, notifyServeStart, type ServeTaskResult } from '../shared/notify';
import type { SubTask, SubTaskContext, SubTaskHandle, SubTaskResult } from '../shared/sub-task';
import { type AwakeOptions, createAwakeTask } from './awake';
import { type LoadEnvOptions, createLoadEnvTask } from './load-env';

interface ServeOptions {
  tasks: string;
  envPath?: string;
  mode: 'both' | 'launchctl' | 'zshrc';
  zshrcPath: string;
  display: boolean;
  idle: boolean;
  disk: boolean;
  system: boolean;
  awakeTimeout?: string;
}

function parseTaskList(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildTasks(opts: ServeOptions): SubTask[] {
  const names = parseTaskList(opts.tasks);
  const tasks: SubTask[] = [];
  for (const name of names) {
    if (name === 'awake') {
      const awakeOpts: AwakeOptions = {
        display: opts.display,
        idle: opts.idle,
        disk: opts.disk,
        system: opts.system,
        timeout: opts.awakeTimeout,
      };
      tasks.push(createAwakeTask(awakeOpts));
    } else if (name === 'load-env') {
      if (!opts.envPath) {
        throw new Error('load-env 子任务需要 --env-path <path>');
      }
      const loadEnvOpts: LoadEnvOptions = {
        envPath: opts.envPath,
        mode: opts.mode,
        zshrcPath: opts.zshrcPath,
        dryRun: false,
      };
      tasks.push(createLoadEnvTask(loadEnvOpts));
    } else {
      throw new Error(`未知子任务 "${name}"(支持: awake, load-env)`);
    }
  }
  if (tasks.length === 0) {
    throw new Error('--tasks 列表解析后为空');
  }
  return tasks;
}

async function runServe(opts: ServeOptions): Promise<void> {
  const startTime = new Date();
  let tasks: SubTask[];
  try {
    tasks = buildTasks(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[boot-tasks serve] 参数错误: ${message}`);
    await notifyServeEnd({
      startTime,
      endTime: new Date(),
      status: 'failed',
      stopped: false,
      taskResults: [{ name: '(startup)', status: 'failed', error: message }],
    });
    process.exit(1);
  }

  const ctx: SubTaskContext = {
    stopped: false,
    log: (msg) => console.log(msg),
  };

  console.log(
    `[boot-tasks serve] 启动子任务: ${tasks.map((t) => `${t.name}(${t.kind})`).join(', ')}`,
  );
  await notifyServeStart({ tasks: tasks.map((t) => t.name), startTime });

  // 1) 启动所有子任务
  const handles: Array<{ task: SubTask; handle: SubTaskHandle }> = [];
  try {
    for (const task of tasks) {
      const handle = await task.start(ctx);
      handles.push({ task, handle });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[boot-tasks serve] 子任务启动失败: ${message}`);
    ctx.stopped = true;
    for (const { handle } of handles) {
      try { handle.stop?.(); } catch { /* swallow */ }
    }
    const endTime = new Date();
    const partial: ServeTaskResult[] = handles.map(({ task }) => ({
      name: task.name,
      status: 'success',
      summary: '已启动(随 supervisor 退出)',
    }));
    partial.push({ name: '(startup)', status: 'failed', error: message });
    await notifyServeEnd({
      startTime,
      endTime,
      status: 'failed',
      stopped: false,
      taskResults: partial,
    });
    process.exit(1);
  }

  // 2) 注册幂等 shutdown handler
  let shutdownReason: 'signal' | 'long-running-exit' | 'completed' | null = null;
  const shutdown = (reason: 'signal' | 'long-running-exit' | 'completed') => {
    if (shutdownReason) return;
    shutdownReason = reason;
    ctx.stopped = true;
    console.log(`[boot-tasks serve] 触发停止(reason=${reason})`);
    for (const { handle } of handles) {
      try { handle.stop?.(); } catch (err) {
        console.warn(`[boot-tasks serve] stop() 抛错:`, err);
      }
    }
  };

  process.on('SIGINT', () => shutdown('signal'));
  process.on('SIGTERM', () => shutdown('signal'));

  // 3) 监听 long-running 退出 / one-shot 全部完成
  const longRunningHandles = handles.filter((h) => h.task.kind === 'long-running');
  const oneShotHandles = handles.filter((h) => h.task.kind === 'one-shot');

  if (longRunningHandles.length > 0) {
    // 任一 long-running 退出(非 shutdown 触发)即触发整体 shutdown,交给 PM2 重启
    await new Promise<void>((resolve) => {
      let settled = false;
      const onSettle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      longRunningHandles.forEach(({ handle }) => {
        void handle.promise.then(() => {
          if (!shutdownReason) {
            shutdown('long-running-exit');
          }
          onSettle();
        });
      });
      // 同时若所有 one-shot 都完成且 long-running 还在跑,这里不退出,继续等 long-running
    });
  } else if (oneShotHandles.length > 0) {
    // 没有 long-running:所有 one-shot 跑完即结束
    await Promise.allSettled(oneShotHandles.map(({ handle }) => handle.promise));
    if (!shutdownReason) shutdown('completed');
  } else {
    if (!shutdownReason) shutdown('completed');
  }

  // 4) 等所有 promise settle,收集结果
  const settled: ServeTaskResult[] = [];
  for (const { task, handle } of handles) {
    let result: SubTaskResult;
    try {
      result = await handle.promise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { status: 'failed', error: message };
    }
    settled.push({ name: task.name, status: result.status, summary: result.summary, error: result.error });
  }

  // 5) 决定整体 status + 发通知 + exit
  const endTime = new Date();
  const allOk = settled.every((r) => r.status === 'success');
  const overallStatus: 'success' | 'failed' =
    shutdownReason === 'signal' ? 'success' : allOk ? 'success' : 'failed';

  console.log(`[boot-tasks serve] 全部结束,status=${overallStatus},reason=${shutdownReason}`);
  await notifyServeEnd({
    startTime,
    endTime,
    status: overallStatus,
    stopped: shutdownReason === 'signal',
    taskResults: settled,
  });

  process.exit(overallStatus === 'success' ? 0 : 1);
}

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('supervisor: 在单个 Node 进程里并发运行多个 boot-tasks 子任务(供 PM2 单 app 使用)')
    .option('--tasks <list>', '逗号分隔的子任务列表', 'awake,load-env')
    .option('-f, --env-path <path>', 'load-env 子任务的 .env 路径(支持 ~)')
    .option('-m, --mode <mode>', 'load-env 注入模式: launchctl | zshrc | both', 'both')
    .option('--zshrc-path <path>', 'load-env zshrc mode 写入路径', '~/.zshrc')
    .option('--no-display', 'awake: 不阻止显示器睡眠')
    .option('--no-idle', 'awake: 不阻止系统 idle 睡眠')
    .option('--no-disk', 'awake: 不阻止磁盘 idle 睡眠')
    .option('--system', 'awake: 阻止系统睡眠(仅 AC 电源生效)', false)
    .option('--awake-timeout <seconds>', 'awake: 运行指定秒数后退出')
    .action(async (opts: ServeOptions) => { await runServe(opts); });
}
