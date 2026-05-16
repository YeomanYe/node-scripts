#!/usr/bin/env node

import { spawn } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { sendFeishuCard } from '../shared/notifiers/feishu';
import type { FeishuChannelConfig, NotifierMessage } from '../shared/notifiers/types';

const DEFAULT_SKILLSHARE_ROOT = path.join(os.homedir(), '.config/skillshare');
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

export type GitSnapshot = Map<string, string>;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ChangedRepo {
  path: string;
  before?: string;
  after: string;
}

export interface SkillshareSyncConfig {
  skillshareRoot: string;
  feishu?: FeishuChannelConfig;
}

export interface SkillshareSyncDeps {
  getSnapshot: (root: string) => Promise<GitSnapshot>;
  runCommand: (cmd: string, args: string[], cwd: string) => Promise<RunResult>;
  notify: (message: NotifierMessage) => Promise<void>;
  log: (message: string) => void;
}

export type SkillshareSyncResult =
  | { status: 'updated'; changedRepos: ChangedRepo[] }
  | { status: 'unchanged' }
  | { status: 'failed'; reason: string };

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function repoName(repoPath: string): string {
  const parent = path.basename(path.dirname(repoPath));
  const name = path.basename(repoPath);
  return parent === 'skillshare' ? name : `${parent}/${name}`;
}

function formatSnapshotRef(value: string | undefined): string {
  if (!value) return 'new';
  const [head, status = ''] = value.split('\n', 2);
  return `${head.slice(0, 7)}${status.trim() ? '+worktree' : ''}`;
}

function compactOutput(result: RunResult): string {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (!text) return `exit code ${result.code}`;
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-12).join('\n');
}

function buildUpdateContent(changedRepos: ChangedRepo[]): string {
  const lines = changedRepos.slice(0, 20).map((repo) => {
    return `- ${repoName(repo.path)}: ${formatSnapshotRef(repo.before)} -> ${formatSnapshotRef(repo.after)}`;
  });
  if (changedRepos.length > 20) {
    lines.push(`- 另外 ${changedRepos.length - 20} 个仓库有更新`);
  }
  return [`已执行 \`skillshare update --all\` 和 \`skillshare sync --all\`。`, '', ...lines].join('\n');
}

function buildFailureContent(step: string, result: RunResult): string {
  return [`步骤失败: \`${step}\``, '', '```', compactOutput(result), '```'].join('\n');
}

function hasFeishuConfig(config: SkillshareSyncConfig): config is SkillshareSyncConfig & { feishu: FeishuChannelConfig } {
  return Boolean(config.feishu?.app_id && config.feishu.app_secret && config.feishu.receive_id);
}

async function maybeNotify(config: SkillshareSyncConfig, deps: SkillshareSyncDeps, message: NotifierMessage): Promise<void> {
  if (!hasFeishuConfig(config)) return;
  await deps.notify(message);
}

export function detectChangedRepos(before: GitSnapshot, after: GitSnapshot): ChangedRepo[] {
  const changed: ChangedRepo[] = [];
  for (const [repoPath, afterHead] of Array.from(after.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const beforeHead = before.get(repoPath);
    if (beforeHead !== afterHead) {
      changed.push({ path: repoPath, before: beforeHead, after: afterHead });
    }
  }
  return changed;
}

export async function runSkillshareSyncNotify(
  config: SkillshareSyncConfig,
  deps: SkillshareSyncDeps = createDefaultDeps(config)
): Promise<SkillshareSyncResult> {
  const preservedMetadata = await readTrackedMetadataFile(config.skillshareRoot);
  try {
    const restore = await ensureTrackedReposInstalled(config, deps, preservedMetadata);
    if (restore.code !== 0) {
      const reason = compactOutput(restore);
      await maybeNotify(config, deps, {
        title: 'Skillshare 同步失败',
        content: buildFailureContent('skillshare install --track --force', restore),
        level: 'warn',
      });
      return { status: 'failed', reason };
    }

    const before = await deps.getSnapshot(config.skillshareRoot);
    const update = await deps.runCommand('skillshare', ['update', '--all'], config.skillshareRoot);
    await restoreMetadataFile(preservedMetadata);
    await normalizeSkillsGitignore(config.skillshareRoot);
    if (update.code !== 0) {
      const reason = compactOutput(update);
      await maybeNotify(config, deps, {
        title: 'Skillshare 同步失败',
        content: buildFailureContent('skillshare update --all', update),
        level: 'warn',
      });
      return { status: 'failed', reason };
    }

    const after = await deps.getSnapshot(config.skillshareRoot);
    const changedRepos = detectChangedRepos(before, after);
    if (changedRepos.length === 0) {
      deps.log(`[${new Date().toISOString()}] skillshare-sync-notify: no updates`);
      return { status: 'unchanged' };
    }

    const sync = await deps.runCommand('skillshare', ['sync', '--all'], config.skillshareRoot);
    await restoreMetadataFile(preservedMetadata);
    await normalizeSkillsGitignore(config.skillshareRoot);
    if (sync.code !== 0) {
      const reason = compactOutput(sync);
      await maybeNotify(config, deps, {
        title: 'Skillshare 同步失败',
        content: buildFailureContent('skillshare sync --all', sync),
        level: 'warn',
      });
      return { status: 'failed', reason };
    }

    await maybeNotify(config, deps, {
      title: 'Skillshare 有更新',
      content: buildUpdateContent(changedRepos),
      level: 'info',
    });
    deps.log(`[${new Date().toISOString()}] skillshare-sync-notify: synced ${changedRepos.length} updated repos`);
    return { status: 'updated', changedRepos };
  } finally {
    await restoreMetadataFile(preservedMetadata);
    await normalizeSkillsGitignore(config.skillshareRoot);
  }
}

export function createDefaultDeps(config: SkillshareSyncConfig): SkillshareSyncDeps {
  return {
    getSnapshot: collectGitSnapshot,
    runCommand,
    notify: async (message) => {
      if (!config.feishu) return;
      await sendFeishuCard(config.feishu, message.title, message.content, message.level);
    },
    log: (message) => process.stdout.write(`${message}\n`),
  };
}

export async function collectGitSnapshot(
  root: string,
  command: (cmd: string, args: string[], cwd: string) => Promise<RunResult> = runCommand
): Promise<GitSnapshot> {
  const trackedRoots = await collectTrackedRepoRoots(root);
  const repos = trackedRoots.length > 0 ? trackedRoots : await findGitRepos(root);
  const snapshot = new Map<string, string>();
  for (const repo of repos) {
    const head = await command('git', ['rev-parse', 'HEAD'], repo);
    if (head.code === 0) {
      const status = await command('git', ['status', '--porcelain=v1'], repo);
      snapshot.set(repo, [head.stdout.trim(), status.code === 0 ? status.stdout.trim() : ''].join('\n'));
    }
  }
  return snapshot;
}

interface SkillshareMetadata {
  entries?: Record<string, { tracked?: unknown; source?: unknown; branch?: unknown } | undefined>;
}

interface TrackedMetadataFile {
  path: string;
  text: string;
  installs: SkillshareInstallSpec[];
}

interface SkillshareInstallSpec {
  name: string;
  source: string;
  branch?: string;
}

function hasTrackedMetadataEntry(metadata: SkillshareMetadata | null): boolean {
  return Object.values(metadata?.entries ?? {}).some((entry) => entry?.tracked === true);
}

function trackedMetadataInstallSpecs(metadata: SkillshareMetadata | null): SkillshareInstallSpec[] {
  const installs: SkillshareInstallSpec[] = [];
  for (const [key, entry] of Object.entries(metadata?.entries ?? {})) {
    if (entry?.tracked !== true) continue;
    const source = entry.source;
    if (typeof source !== 'string' || !source) continue;
    installs.push({
      name: key,
      source,
      branch: typeof entry.branch === 'string' && entry.branch ? entry.branch : undefined,
    });
  }

  return installs.sort((a, b) => a.name.localeCompare(b.name));
}

async function readTrackedMetadataFile(root: string): Promise<TrackedMetadataFile | undefined> {
  const metadataFiles = ['.metadata.json', 'meta.json'];
  for (const metadataFile of metadataFiles) {
    try {
      const metadataPath = path.join(root, 'skills', metadataFile);
      const text = await fs.readFile(metadataPath, 'utf8');
      return {
        path: metadataPath,
        text,
        installs: trackedMetadataInstallSpecs(JSON.parse(text) as SkillshareMetadata | null),
      };
    } catch {
      // Try the next metadata filename.
    }
  }
  return undefined;
}

async function restoreMetadataFile(metadata: TrackedMetadataFile | undefined): Promise<void> {
  if (!metadata) return;
  await fs.writeFile(metadata.path, metadata.text);
}

async function isTrackedRepoInstalled(root: string, install: SkillshareInstallSpec): Promise<boolean> {
  try {
    await fs.access(path.join(root, 'skills', install.name, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function normalizeSkillsGitignore(root: string): Promise<void> {
  const gitignorePath = path.join(root, 'skills', '.gitignore');
  const begin = '# BEGIN SKILLSHARE MANAGED - DO NOT EDIT';
  const end = '# END SKILLSHARE MANAGED';
  let text: string;
  try {
    text = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    return;
  }

  const lines = text.split(/\r?\n/);
  const beginIndex = lines.indexOf(begin);
  const endIndex = lines.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) return;

  const nextLines = [
    ...lines.slice(0, beginIndex + 1),
    ...lines.slice(endIndex),
  ];
  const nextText = nextLines.join('\n');
  if (nextText !== text) {
    await fs.writeFile(gitignorePath, nextText);
  }
}

async function ensureTrackedReposInstalled(
  config: SkillshareSyncConfig,
  deps: SkillshareSyncDeps,
  metadata: TrackedMetadataFile | undefined
): Promise<RunResult> {
  if (!metadata || metadata.installs.length === 0) {
    return { code: 0, stdout: '', stderr: '' };
  }

  let stdout = '';
  let stderr = '';
  for (const install of metadata.installs) {
    if (await isTrackedRepoInstalled(config.skillshareRoot, install)) continue;
    const args = ['install', install.source, '--track'];
    if (install.branch) {
      args.push('--branch', install.branch);
    }
    args.push('--name', install.name.replace(/^_+/, ''), '--force');
    const result = await deps.runCommand('skillshare', args, config.skillshareRoot);
    await restoreMetadataFile(metadata);
    await normalizeSkillsGitignore(config.skillshareRoot);
    stdout += result.stdout;
    stderr += result.stderr;
    if (result.code !== 0) {
      return { code: result.code, stdout, stderr };
    }
  }
  return { code: 0, stdout, stderr };
}

export async function collectTrackedMetadataRoots(root: string): Promise<string[]> {
  const sourceDirs = ['skills', 'agents'];
  const metadataFiles = ['.metadata.json', 'meta.json'];
  const trackedRoots: string[] = [];

  for (const sourceDir of sourceDirs) {
    const absoluteSourceDir = path.join(root, sourceDir);
    for (const metadataFile of metadataFiles) {
      try {
        const text = await fs.readFile(path.join(absoluteSourceDir, metadataFile), 'utf8');
        if (hasTrackedMetadataEntry(JSON.parse(text) as SkillshareMetadata | null)) {
          trackedRoots.push(absoluteSourceDir);
          break;
        }
      } catch {
        // Missing or invalid metadata means this source is not managed as a tracked skillshare source.
      }
    }
  }

  return trackedRoots.sort();
}

async function collectTrackedRepoRoots(root: string): Promise<string[]> {
  const metadata = await readTrackedMetadataFile(root);
  if (!metadata) return [];

  const roots: string[] = [];
  for (const install of metadata.installs) {
    const repoPath = path.join(root, 'skills', install.name);
    try {
      await fs.access(path.join(repoPath, '.git'));
      roots.push(repoPath);
    } catch {
      // Missing tracked repos are restored before update; skip them for snapshots.
    }
  }
  return roots.sort();
}

async function findGitRepos(root: string): Promise<string[]> {
  const repos: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.name === '.git')) {
      repos.push(dir);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.cache')) continue;
      await visit(path.join(dir, entry.name));
    }
  }

  await visit(root);
  return repos.sort();
}

export function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
): Promise<RunResult> {
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
      resolve({ code: -1, stdout, stderr: stderr + err.message });
    });
  });
}

function asFeishuChannel(value: unknown): FeishuChannelConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== 'feishu') return undefined;
  return {
    type: 'feishu',
    app_id: typeof record.app_id === 'string' ? record.app_id : '',
    app_secret: typeof record.app_secret === 'string' ? record.app_secret : '',
    receive_id: typeof record.receive_id === 'string' ? record.receive_id : '',
    receive_id_type: typeof record.receive_id_type === 'string'
      ? record.receive_id_type as FeishuChannelConfig['receive_id_type']
      : 'chat_id',
    domain: typeof record.domain === 'string' ? record.domain : undefined,
  };
}

function readFeishuFromConfigFile(
  configPath: string,
  readFile: (filePath: string) => string
): FeishuChannelConfig | undefined {
  try {
    const parsed = parseYaml(readFile(configPath)) as { channels?: unknown[] } | null;
    const channels = Array.isArray(parsed?.channels) ? parsed.channels : [];
    for (const channel of channels) {
      const feishu = asFeishuChannel(channel);
      if (feishu) return feishu;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveConfigPath(env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  const raw = env.SKILLSHARE_NOTIFY_CONFIG;
  if (raw) return path.resolve(cwd, raw);
  const fallback = path.resolve(cwd, 'local/claude-usage-config.yaml');
  return fsSync.existsSync(fallback) ? fallback : undefined;
}

export function readConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  readFile: (filePath: string) => string = (filePath) => fsSync.readFileSync(filePath, 'utf8')
): SkillshareSyncConfig {
  const configPath = resolveConfigPath(env, cwd);
  const fileFeishu = configPath ? readFeishuFromConfigFile(configPath, readFile) : undefined;
  const envFeishu = {
    type: 'feishu' as const,
    app_id: env.SKILLSHARE_FEISHU_APP_ID || env.FEISHU_APP_ID || '',
    app_secret: env.SKILLSHARE_FEISHU_APP_SECRET || env.FEISHU_APP_SECRET || '',
    receive_id: env.SKILLSHARE_FEISHU_RECEIVE_ID || env.FEISHU_RECEIVE_ID || '',
    receive_id_type: (env.SKILLSHARE_FEISHU_RECEIVE_ID_TYPE || env.FEISHU_RECEIVE_ID_TYPE || 'chat_id') as FeishuChannelConfig['receive_id_type'],
    domain: env.SKILLSHARE_FEISHU_DOMAIN || env.FEISHU_DOMAIN,
  };

  return {
    skillshareRoot: path.resolve(env.SKILLSHARE_ROOT || DEFAULT_SKILLSHARE_ROOT),
    feishu: hasFeishuConfig({ skillshareRoot: '', feishu: envFeishu }) ? envFeishu : fileFeishu,
  };
}

async function main(): Promise<void> {
  const config = readConfigFromEnv();
  process.stdout.write(
    `[${new Date().toISOString()}] skillshare-sync-notify: root=${shellQuote(config.skillshareRoot)}\n`
  );
  const result = await runSkillshareSyncNotify(config);
  if (result.status === 'failed') {
    throw new Error(result.reason);
  }
}

if (require.main === module) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
  });
}
