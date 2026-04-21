#!/usr/bin/env node

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_ROOT = path.join(os.homedir(), 'Documents/projects');
const DEFAULT_INTERVAL_SEC = 60 * 60;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message });
    });
  });
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    // .git can be a directory (normal repo) or a file (submodules / worktrees)
    await fs.stat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

type PullOutcome =
  | { status: 'skip'; reason: string }
  | { status: 'ok'; summary: string }
  | { status: 'fail'; reason: string };

async function pullRepo(dir: string): Promise<PullOutcome> {
  const branchR = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
  if (branchR.code !== 0) {
    return { status: 'skip', reason: 'detached HEAD' };
  }
  const branch = branchR.stdout.trim();

  const trackR = await run('git', ['rev-parse', '--abbrev-ref', `${branch}@{u}`], dir);
  if (trackR.code !== 0) {
    return { status: 'skip', reason: `no upstream for ${branch}` };
  }

  const statusR = await run('git', ['status', '--porcelain'], dir);
  if (statusR.stdout.trim() !== '') {
    return { status: 'skip', reason: 'dirty working tree' };
  }

  const pullR = await run('git', ['pull', '--ff-only'], dir);
  if (pullR.code !== 0) {
    const tail = (pullR.stderr || pullR.stdout).trim().split('\n').slice(-1)[0] ?? 'unknown error';
    return { status: 'fail', reason: tail };
  }

  return { status: 'ok', summary: summarizePull(pullR.stdout) };
}

function summarizePull(stdout: string): string {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /already up to date/i.test(l))) return 'already up to date';

  const updating = lines.find((l) => /^Updating [0-9a-f]+\.\.[0-9a-f]+$/.test(l));
  const stat = lines.find((l) => /\d+ files? changed/.test(l));
  if (updating && stat) return `${updating} (${stat})`;
  if (updating) return updating;
  return lines[lines.length - 1] ?? 'pulled';
}

async function listRepos(root: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`无法读取目录 ${root}: ${msg}`);
  }
  const repos: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (await isGitRepo(full)) repos.push(full);
  }
  return repos.sort();
}

async function tick(root: string): Promise<void> {
  const started = Date.now();
  const now = new Date().toISOString();
  const repos = await listRepos(root);
  process.stdout.write(`[${now}] git-pull-poll: scanning ${repos.length} repos in ${root}\n`);

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const repo of repos) {
    const name = path.basename(repo);
    try {
      const outcome = await pullRepo(repo);
      if (outcome.status === 'ok') {
        okCount++;
        process.stdout.write(`  ✓ ${name}: ${outcome.summary}\n`);
      } else if (outcome.status === 'skip') {
        skipCount++;
        process.stdout.write(`  - ${name}: skip (${outcome.reason})\n`);
      } else {
        failCount++;
        process.stderr.write(`  ✗ ${name}: ${outcome.reason}\n`);
      }
    } catch (err) {
      failCount++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ✗ ${name}: exception ${msg}\n`);
    }
  }

  const ms = Date.now() - started;
  process.stdout.write(
    `[${new Date().toISOString()}] git-pull-poll: done in ${ms}ms — ok=${okCount} skip=${skipCount} fail=${failCount}\n`
  );
}

const signal = { stopped: false };

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (signal.stopped) return;
    signal.stopped = true;
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

async function main(): Promise<void> {
  const root = process.env.PROJECTS_ROOT || DEFAULT_ROOT;
  const intervalSec = parseInt(process.env.POLL_INTERVAL_SEC ?? '', 10) || DEFAULT_INTERVAL_SEC;

  process.stdout.write(
    `[${new Date().toISOString()}] git-pull-poll started (interval=${intervalSec}s, root=${root})\n`
  );

  const wrapped = async (): Promise<void> => {
    if (signal.stopped) return;
    try {
      await tick(root);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[${new Date().toISOString()}] tick failed: ${msg}\n`);
    }
  };

  await wrapped();
  setInterval(() => {
    if (signal.stopped) return;
    void wrapped();
  }, intervalSec * 1000);
}

if (require.main === module) {
  setupSignalHandlers();
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
  });
}
