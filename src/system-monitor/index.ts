#!/usr/bin/env node

import { Command } from 'commander';
import { collectSample } from './metrics';
import { DEFAULT_CONFIG_PATH, loadMonitorConfig } from './config';
import { buildTickMessage, runPoll } from './poll';
import { MetricStateMachine } from './state';

const stopSignal = { stopped: false };

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

function parseSeconds(raw: string | true, defaultSec: number): number {
  const n = raw === true ? defaultSec : parseInt(raw, 10);
  if (isNaN(n) || n < 1) throw new Error('间隔必须为正整数');
  return n;
}

async function once(configPath: string, json: boolean): Promise<void> {
  const config = await loadMonitorConfig(configPath);
  const sample = await collectSample({ disks: config.disks });
  if (json) {
    process.stdout.write(JSON.stringify(sample, null, 2) + '\n');
    return;
  }
  const fsm = new MetricStateMachine();
  const { summary, message } = buildTickMessage(sample, config, fsm);
  process.stdout.write(summary + '\n');
  if (message) {
    process.stdout.write('\n' + message.title + '\n\n' + message.content + '\n');
  }
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('system-monitor')
    .description('监控本机 CPU/内存/Load/磁盘并通过飞书告警')
    .version('1.0.0')
    .option('-c, --config <path>', `配置路径 (默认 ${DEFAULT_CONFIG_PATH})`)
    .option('-p, --poll [seconds]', '常驻轮询模式；不传 seconds 则使用配置文件 poll.interval_seconds')
    .option('--once', '只采样一次，打印到 stdout 后退出（不发飞书）')
    .option('--json', '采样结果以 JSON 输出（配合 --once 使用）')
    .action(async (options: { config?: string; poll?: string | true; once?: boolean; json?: boolean }) => {
      const configPath = options.config ?? DEFAULT_CONFIG_PATH;

      if (options.once || options.poll === undefined) {
        try {
          await once(configPath, options.json ?? false);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`错误: ${message}\n`);
          process.exit(1);
        }
        return;
      }

      try {
        const config = await loadMonitorConfig(configPath);
        const intervalSec =
          options.poll === true ? config.poll.interval_seconds : parseSeconds(options.poll, config.poll.interval_seconds);
        process.stdout.write(
          `[${new Date().toISOString()}] system-monitor poll started (interval=${intervalSec}s, channels=${config.channels.length}, disks=[${config.disks.join(',')}])\n`
        );
        await runPoll({ intervalSec, config, signal: stopSignal });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`错误: ${message}\n`);
        process.exit(1);
      }
    });

  return program;
}

if (require.main === module) {
  setupSignalHandlers();
  createProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
