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
  | { status: 'ok'; summary: string; changed: string[] }
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

  const beforeR = await run('git', ['rev-parse', 'HEAD'], dir);
  const before = beforeR.stdout.trim();

  const pullR = await run('git', ['pull', '--ff-only'], dir);
  if (pullR.code !== 0) {
    const tail = (pullR.stderr || pullR.stdout).trim().split('\n').slice(-1)[0] ?? 'unknown error';
    return { status: 'fail', reason: tail };
  }

  // 拉取真带来更新时,取 before..after 的变更文件,供安装判定使用。
  const afterR = await run('git', ['rev-parse', 'HEAD'], dir);
  const after = afterR.stdout.trim();
  let changed: string[] = [];
  if (before && after && before !== after) {
    const diffR = await run('git', ['diff', '--name-only', before, after], dir);
    if (diffR.code === 0) {
      changed = diffR.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  }

  return { status: 'ok', summary: summarizePull(pullR.stdout), changed };
}

// ───────────────────────── 依赖自动安装(Node 项目) ─────────────────────────

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

const LOCKFILES: Record<PackageManager, string> = {
  pnpm: 'pnpm-lock.yaml',
  npm: 'package-lock.json',
  yarn: 'yarn.lock'
};

const MANIFEST_TRIGGERS = new Set<string>([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock'
]);

/**
 * 根据仓库根目录的文件名列表判定包管理器。
 * 无 package.json → null(非 Node 项目)。有 lockfile 按 lockfile 定;
 * 只有 package.json 没 lockfile → 默认 pnpm(本机约定)。多 lockfile 优先 pnpm。
 */
export function detectPackageManager(rootEntries: string[]): PackageManager | null {
  const set = new Set(rootEntries);
  if (!set.has('package.json')) return null;
  if (set.has(LOCKFILES.pnpm)) return 'pnpm';
  if (set.has(LOCKFILES.npm)) return 'npm';
  if (set.has(LOCKFILES.yarn)) return 'yarn';
  return 'pnpm';
}

/** 本次 pull 的变更文件里是否动了 package.json / lockfile(含 monorepo 嵌套路径)。 */
export function shouldInstallForChanges(changedFiles: string[]): boolean {
  return changedFiles.some((f) => MANIFEST_TRIGGERS.has(path.basename(f)));
}

/** 包管理器 → install 命令。 */
export function installArgs(pm: PackageManager): { bin: string; args: string[] } {
  return { bin: pm, args: ['install'] };
}

/**
 * 包管理器二进制候选路径:裸名优先(走 PATH),再兜底常见安装位置
 * (cron/pm2 环境 PATH 可能很小,参考 .githooks/post-merge 的 pnpm 解析)。
 */
export function packageManagerCandidates(pm: PackageManager, home: string): string[] {
  return [
    pm,
    path.join(home, '.local/share/pnpm', pm),
    path.join(home, 'Library/pnpm', pm),
    `/opt/homebrew/bin/${pm}`,
    `/usr/local/bin/${pm}`
  ];
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

/** 解析包管理器二进制:裸名(PATH)不可用时回退到候选绝对路径。 */
async function resolvePackageManagerBin(pm: PackageManager): Promise<string> {
  const candidates = packageManagerCandidates(pm, os.homedir());
  for (const c of candidates.slice(1)) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // 继续试下一个
    }
  }
  return candidates[0]; // 都没命中绝对路径 → 退回裸名走 PATH
}

type InstallOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'installed'; pm: PackageManager }
  | { status: 'failed'; pm: PackageManager; reason: string };

/**
 * pull 带来更新后,若是 Node 项目且本次改了 package.json/lockfile,则自动安装依赖。
 * 失败只回报、不抛(不中断对其它仓库的轮询)。
 */
async function maybeInstall(dir: string, changedFiles: string[]): Promise<InstallOutcome> {
  if (!shouldInstallForChanges(changedFiles)) {
    return { status: 'skipped', reason: 'no manifest/lockfile change' };
  }
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'skipped', reason: `readdir failed: ${msg}` };
  }
  const pm = detectPackageManager(entries);
  if (!pm) return { status: 'skipped', reason: 'not a Node project' };

  const bin = await resolvePackageManagerBin(pm);
  const { args } = installArgs(pm);
  const r = await run(bin, args, dir, 300_000);
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).trim().split('\n').slice(-1)[0] ?? 'unknown error';
    return { status: 'failed', pm, reason: tail };
  }
  return { status: 'installed', pm };
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

type Target = { mode: 'scan'; root: string } | { mode: 'single'; repo: string };

async function tick(target: Target): Promise<void> {
  const started = Date.now();
  const now = new Date().toISOString();
  let repos: string[];
  if (target.mode === 'single') {
    repos = [target.repo];
    process.stdout.write(`[${now}] git-pull-poll: single repo ${target.repo}\n`);
  } else {
    repos = await listRepos(target.root);
    process.stdout.write(`[${now}] git-pull-poll: scanning ${repos.length} repos in ${target.root}\n`);
  }

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
        if (outcome.changed.length > 0) {
          const inst = await maybeInstall(repo, outcome.changed);
          if (inst.status === 'installed') {
            process.stdout.write(`    ↳ ${name}: ${inst.pm} install ✓\n`);
          } else if (inst.status === 'failed') {
            process.stderr.write(`    ↳ ${name}: ${inst.pm} install ✗ (${inst.reason})\n`);
          }
        }
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

function parseRepoArg(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') return argv[i + 1];
    if (a.startsWith('--repo=')) return a.slice('--repo='.length);
  }
  return undefined;
}

async function main(): Promise<void> {
  const repoArg = parseRepoArg(process.argv) ?? process.env.REPO_PATH;
  const intervalSec = parseInt(process.env.POLL_INTERVAL_SEC ?? '', 10) || DEFAULT_INTERVAL_SEC;

  let target: Target;
  if (repoArg) {
    const repo = path.resolve(repoArg);
    if (!(await isGitRepo(repo))) {
      throw new Error(`${repo} 不是 git 仓库`);
    }
    target = { mode: 'single', repo };
  } else {
    target = { mode: 'scan', root: process.env.PROJECTS_ROOT || DEFAULT_ROOT };
  }

  const startedLabel = target.mode === 'single' ? `repo=${target.repo}` : `root=${target.root}`;
  process.stdout.write(
    `[${new Date().toISOString()}] git-pull-poll started (interval=${intervalSec}s, ${startedLabel})\n`
  );

  const wrapped = async (): Promise<void> => {
    if (signal.stopped) return;
    try {
      await tick(target);
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
