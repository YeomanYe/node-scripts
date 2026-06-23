import { sendFeishuCard } from '../../shared/notifiers/feishu';
import { loadFeishuConfig } from './feishu-config';

function fmtTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s - m * 60).toFixed(0)}s`;
}

export interface NotifyStartOptions {
  command: string;
  summary?: string;
}

export interface NotifyEndOptions {
  command: string;
  startTime: Date;
  endTime: Date;
  status: 'success' | 'failed';
  summary?: string;
  error?: string;
}

async function sendCard(title: string, content: string, level: 'info' | 'warn'): Promise<void> {
  const { config, source, reason } = loadFeishuConfig();
  if (!config) {
    console.warn(`[boot-tasks notify] skip (${reason}; tried: ${source})`);
    return;
  }
  try {
    await sendFeishuCard(config, title, content, level);
  } catch (err) {
    console.warn(`[boot-tasks notify] feishu send failed:`, err);
  }
}

export async function notifyStart(opts: NotifyStartOptions): Promise<void> {
  const lines = [
    `**命令**: \`boot-tasks ${opts.command}\``,
    `**开始**: ${fmtTime(new Date())}`,
  ];
  if (opts.summary) lines.push('', opts.summary);
  await sendCard(`▶️ boot-tasks · ${opts.command} 已启动`, lines.join('\n'), 'info');
}

export interface ServeTaskResult {
  name: string;
  status: 'success' | 'failed';
  summary?: string;
  error?: string;
}

export interface NotifyServeStartOptions {
  tasks: string[];
  startTime?: Date;
}

export interface NotifyServeEndOptions {
  startTime: Date;
  endTime: Date;
  status: 'success' | 'failed';
  taskResults: ServeTaskResult[];
  stopped: boolean;
}

export async function notifyServeStart(opts: NotifyServeStartOptions): Promise<void> {
  const lines = [
    `**命令**: \`boot-tasks serve\``,
    `**开始**: ${fmtTime(opts.startTime ?? new Date())}`,
    `**子任务**: ${opts.tasks.join(', ')}`,
  ];
  await sendCard(`▶️ boot-tasks · serve 已启动`, lines.join('\n'), 'info');
}

export async function notifyServeEnd(opts: NotifyServeEndOptions): Promise<void> {
  const durationMs = opts.endTime.getTime() - opts.startTime.getTime();
  const icon = opts.status === 'success' ? '✅' : '❌';
  const lines = [
    `**命令**: \`boot-tasks serve\``,
    `**开始**: ${fmtTime(opts.startTime)}`,
    `**结束**: ${fmtTime(opts.endTime)}`,
    `**耗时**: ${fmtDuration(durationMs)}`,
    `**状态**: ${opts.status}${opts.stopped ? '(信号触发)' : ''}`,
  ];
  if (opts.taskResults.length > 0) {
    lines.push('', '**子任务结果**:');
    for (const r of opts.taskResults) {
      const ricon = r.status === 'success' ? '✅' : '❌';
      const tail = r.error ? ` · \`${r.error}\`` : (r.summary ? ` · ${r.summary}` : '');
      lines.push(`- ${ricon} ${r.name}${tail}`);
    }
  }
  const level = opts.status === 'success' ? 'info' : 'warn';
  await sendCard(`${icon} boot-tasks · serve ${opts.status === 'success' ? '完成' : '失败'}`, lines.join('\n'), level);
}

export async function notifyEnd(opts: NotifyEndOptions): Promise<void> {
  const durationMs = opts.endTime.getTime() - opts.startTime.getTime();
  const icon = opts.status === 'success' ? '✅' : '❌';
  const lines = [
    `**命令**: \`boot-tasks ${opts.command}\``,
    `**开始**: ${fmtTime(opts.startTime)}`,
    `**结束**: ${fmtTime(opts.endTime)}`,
    `**耗时**: ${fmtDuration(durationMs)}`,
    `**状态**: ${opts.status}`,
  ];
  if (opts.summary) lines.push('', opts.summary);
  if (opts.error) lines.push('', `**错误**:\n\`\`\`\n${opts.error}\n\`\`\``);
  const level = opts.status === 'success' ? 'info' : 'warn';
  await sendCard(`${icon} boot-tasks · ${opts.command} ${opts.status === 'success' ? '完成' : '失败'}`, lines.join('\n'), level);
}

export interface OneShotRunner<T> {
  command: string;
  run: () => Promise<{ summary?: string } & T>;
}

export async function runOneShotWithNotify<T = unknown>(runner: OneShotRunner<T>): Promise<void> {
  const startTime = new Date();
  try {
    const result = await runner.run();
    const endTime = new Date();
    await notifyEnd({
      command: runner.command,
      startTime,
      endTime,
      status: 'success',
      summary: result.summary,
    });
    process.exit(0);
  } catch (err) {
    const endTime = new Date();
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[boot-tasks ${runner.command}] failed:`, err);
    await notifyEnd({
      command: runner.command,
      startTime,
      endTime,
      status: 'failed',
      error: message,
    });
    process.exit(1);
  }
}
