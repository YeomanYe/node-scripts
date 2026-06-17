#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs/promises';
import { watch as fsWatch, type FSWatcher } from 'fs';
import * as path from 'path';
import {
  DEFAULT_SOURCE_ROOT,
  DEFAULT_TARGET_ROOT,
  applyKnowledgeSync,
  defaultStatePath,
  type KnowledgeSyncResult,
} from './sync';
import { DebouncedRunner } from './watch';

interface OnceOptions {
  source: string;
  target: string;
  state?: string;
  ignore?: string;
  apply?: boolean;
  rescan?: boolean;
  apiBase: string;
  projectId?: string;
}

interface WatchOptions extends OnceOptions {
  debounce: string;
  interval: string;
}

interface ResolvedSyncOptions {
  sourceRoot: string;
  targetRoot: string;
  statePath: string;
  ignorePath?: string;
  apiBase: string;
  projectId?: string;
  rescan: boolean;
}

const program = new Command();

program
  .name('knowledge-sync')
  .description('Sync ~/Documents/knowledge into LLM Wiki raw/sources/knowledge')
  .version('1.0.0');

function withCommonOptions(command: Command): Command {
  return command
    .option('--source <path>', 'Source knowledge directory', DEFAULT_SOURCE_ROOT)
    .option('--target <path>', 'Target LLM Wiki raw source directory', DEFAULT_TARGET_ROOT)
    .option('--state <path>', 'Sync state JSON path; defaults to <source>/.llm-wiki-sync-state.json')
    .option('--ignore <path>', 'Extra ignore file; defaults to <source>/.llm-wiki-syncignore')
    .option('--no-rescan', 'Do not call LLM Wiki rescan after an applied sync')
    .option('--api-base <url>', 'LLM Wiki API base URL', 'http://127.0.0.1:19828/api/v1')
    .option('--project-id <id>', 'LLM Wiki project id; defaults to target project .llm-wiki/project.json');
}

withCommonOptions(
  program
    .command('once', { isDefault: true })
    .description('Run one sync pass. Dry-run by default; pass --apply to write changes.')
    .option('--apply', 'Copy/delete files and update state')
)
  .action(async (options: OnceOptions) => {
    try {
      const resolved = resolveSyncOptions(options);
      const result = await applyKnowledgeSync({
        sourceRoot: resolved.sourceRoot,
        targetRoot: resolved.targetRoot,
        statePath: resolved.statePath,
        ignorePath: resolved.ignorePath,
        apply: Boolean(options.apply),
      });

      printResult(result.actions, result.summary, Boolean(options.apply));

      if (options.apply && resolved.rescan) {
        await maybeRescan(result, resolved);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });

withCommonOptions(
  program
    .command('watch')
    .description('Watch the source directory and auto-apply sync (+ rescan) on changes.')
    .option('--debounce <ms>', 'Debounce window to coalesce bursts of fs events', '2000')
    .option('--interval <sec>', 'Safety fallback poll interval (catches missed fs events)', '30')
)
  .action(async (options: WatchOptions) => {
    try {
      await runWatch(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);

function resolveSyncOptions(options: OnceOptions): ResolvedSyncOptions {
  const sourceRoot = path.resolve(expandHome(options.source));
  const targetRoot = path.resolve(expandHome(options.target));
  const statePath = path.resolve(expandHome(options.state ?? defaultStatePath(sourceRoot)));
  const ignorePath = options.ignore ? path.resolve(expandHome(options.ignore)) : undefined;
  return {
    sourceRoot,
    targetRoot,
    statePath,
    ignorePath,
    apiBase: options.apiBase,
    projectId: options.projectId,
    rescan: options.rescan !== false,
  };
}

/** 应用同步后，若有 copy/delete 且 rescan 开启则请求 rescan。 */
async function maybeRescan(result: KnowledgeSyncResult, resolved: ResolvedSyncOptions): Promise<void> {
  const changed = result.summary.copied > 0 || result.summary.deleted > 0;
  if (!changed) return;
  const projectId = resolved.projectId ?? (await readProjectIdFromTarget(resolved.targetRoot));
  if (projectId) {
    await triggerRescan(resolved.apiBase, projectId);
    process.stdout.write(`rescan: requested for project ${projectId}\n`);
  } else {
    process.stderr.write('rescan: skipped; could not resolve project id\n');
  }
}

async function runWatch(options: WatchOptions): Promise<void> {
  const resolved = resolveSyncOptions(options);
  const debounceMs = Number.parseInt(options.debounce, 10);
  const intervalSec = Number.parseInt(options.interval, 10);
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new Error(`invalid --debounce: ${options.debounce}`);
  }
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error(`invalid --interval: ${options.interval}`);
  }

  const runSync = async (): Promise<void> => {
    const started = Date.now();
    const result = await applyKnowledgeSync({
      sourceRoot: resolved.sourceRoot,
      targetRoot: resolved.targetRoot,
      statePath: resolved.statePath,
      ignorePath: resolved.ignorePath,
      apply: true,
    });
    const ms = Date.now() - started;
    process.stdout.write(
      `[${timestamp()}] knowledge-sync: copy=${result.summary.copied} delete=${result.summary.deleted} skip=${result.summary.skipped} (${ms}ms)\n`
    );
    if (resolved.rescan) {
      await maybeRescan(result, resolved);
    }
  };

  const runner = new DebouncedRunner({
    runSync,
    debounceMs,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[${timestamp()}] knowledge-sync sync failed: ${message}\n`);
    },
  });

  // 先装 watcher，再跑初始同步：否则「初始同步结束 → watcher 装好」之间的文件改动会丢，
  // 直到首次兜底轮询（最多 interval 秒后）才被捕获。先装 watcher 是安全的——DebouncedRunner
  // 串行化执行：初始同步期间到来的事件只会设置 pending/起防抖，不会启动第二次 run，
  // 而是在初始 run 结束后合并补跑一次（coalesce），故初始同步仍恰好执行一次。
  // 1) fs.watch 即时反应（macOS 支持 recursive）。fs.watch 可能丢事件，故配 2) 兜底轮询。
  let watcher: FSWatcher | undefined;
  try {
    watcher = fsWatch(resolved.sourceRoot, { recursive: true }, () => {
      runner.trigger();
    });
    watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[${timestamp()}] knowledge-sync watch error: ${message}\n`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[${timestamp()}] knowledge-sync: fs.watch unavailable (${message}); relying on interval poll\n`
    );
  }

  // watcher 已就位，现在跑初始同步（直接执行，不走防抖）。
  process.stdout.write(`[${timestamp()}] knowledge-sync: initial sync\n`);
  await runSync().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${timestamp()}] knowledge-sync initial sync failed: ${message}\n`);
  });

  // 2) 兜底轮询：即便 fs 事件丢失，也定期跑一遍（Syncthing 等外部同步场景常见）。
  const pollTimer = setInterval(() => {
    runner.trigger();
  }, intervalSec * 1000);

  process.stdout.write(
    `[${timestamp()}] knowledge-sync watch started (source=${resolved.sourceRoot}, debounce=${debounceMs}ms, interval=${intervalSec}s)\n`
  );

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = (sig: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.stdout.write(`[${timestamp()}] knowledge-sync watch stopping (${sig})\n`);
      runner.stop();
      clearInterval(pollTimer);
      watcher?.close();
      void runner.whenIdle().then(() => {
        process.stdout.write(`[${timestamp()}] knowledge-sync watch stopped\n`);
        resolve();
      });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

  process.exitCode = 0;
}

function timestamp(): string {
  return new Date().toISOString();
}

function printResult(
  actions: Array<{ kind: string; relativePath: string; reason: string }>,
  summary: { copied: number; deleted: number; skipped: number },
  apply: boolean
): void {
  process.stdout.write(`${apply ? 'apply' : 'dry-run'}: copy=${summary.copied} delete=${summary.deleted} skip=${summary.skipped}\n`);
  for (const action of actions) {
    const mark = action.kind === 'copy' ? '+' : '-';
    process.stdout.write(`  ${mark} ${action.relativePath} (${action.reason})\n`);
  }
}

function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input;
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '', input.slice(2));
  return input;
}

async function readProjectIdFromTarget(targetRoot: string): Promise<string | undefined> {
  const projectRoot = path.resolve(targetRoot, '..', '..', '..');
  try {
    const raw = await fs.readFile(path.join(projectRoot, '.llm-wiki', 'project.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id;
  } catch {
    return undefined;
  }
}

async function triggerRescan(apiBase: string, projectId: string): Promise<void> {
  const url = `${apiBase.replace(/\/$/, '')}/projects/${encodeURIComponent(projectId)}/sources/rescan`;
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`rescan failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
  }
}
