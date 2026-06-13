#!/usr/bin/env node

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { sendFeishuCard } from '../shared/notifiers/feishu';
import type { FeishuChannelConfig, NotifierMessage } from '../shared/notifiers/types';

const DEFAULT_SKILLSHARE_ROOT = path.join(os.homedir(), '.config/skillshare');
const DEFAULT_COMMAND_TIMEOUT_MS = 12 * 60_000;
const COMMAND_OUTPUT_LINE_LIMIT = 12;
const SYNC_CONFIG_RELATIVE_PATHS = [
  'config.yaml',
  'skills/.metadata.json',
  'skills/meta.json',
  'agents/.metadata.json',
  'agents/meta.json',
  'skills/.skillignore',
  'agents/.skillignore',
  'skills/.gitignore',
  'agents/.gitignore',
];

export type GitSnapshot = Map<string, string>;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  timeoutMs?: number;
  signal?: NodeJS.Signals | null;
}

export interface ChangedRepo {
  path: string;
  before?: string;
  after: string;
}

interface AuditBlockedUpdate {
  result: RunResult;
  skills: string[];
}

export interface SkillshareSyncConfig {
  skillshareRoot: string;
  stateFile?: string;
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

export type ConfigSnapshot = Record<string, string>;

interface SkillshareSyncState {
  configSnapshot?: ConfigSnapshot;
  updatedAt?: string;
}

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
  const metaLines: string[] = [];
  if (result.timedOut) {
    metaLines.push(`command timed out after ${formatDuration(result.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)}`);
  }
  if (result.signal) {
    metaLines.push(`terminated by signal ${result.signal}`);
  }

  const text = `${result.stderr}\n${result.stdout}`.trim();
  const outputLines = text
    ? text.split('\n').map((line) => line.trim()).filter(Boolean)
    : [`exit code ${result.code}`];
  const outputLimit = Math.max(1, COMMAND_OUTPUT_LINE_LIMIT - metaLines.length);
  return [...metaLines, ...outputLines.slice(-outputLimit)].join('\n');
}

function formatDuration(ms: number): string {
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function readCommandTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SKILLSHARE_SYNC_COMMAND_TIMEOUT_MS || env.SKILLSHARE_COMMAND_TIMEOUT_MS;
  if (!raw) return DEFAULT_COMMAND_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.trunc(parsed);
}

function buildUpdateContent(changedRepos: ChangedRepo[]): string {
  const lines = changedRepos.slice(0, 20).map((repo) => {
    return `- ${repoName(repo.path)}: ${formatSnapshotRef(repo.before)} -> ${formatSnapshotRef(repo.after)}`;
  });
  if (changedRepos.length > 20) {
    lines.push(`- 另外 ${changedRepos.length - 20} 个来源有更新`);
  }
  return [`已执行 \`skillshare update --all\` 和 \`skillshare sync --all\`。`, '', ...lines].join('\n');
}

function isContinuableUpdateFailure(result: RunResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;
  return result.code !== 0 && /Update complete:/i.test(output) && /Blocked:/i.test(output);
}

function extractAuditBlockedSkills(result: RunResult): string[] {
  const output = `${result.stderr}\n${result.stdout}`;
  const skills = new Set<string>();
  for (const line of output.split('\n')) {
    const match = line.match(/✗\s+(.+?)\s+blocked by security audit/i);
    if (match?.[1] && !/^\d+\s+repo\(s\)$/i.test(match[1])) {
      skills.add(match[1]);
    }
  }
  return Array.from(skills).sort((a, b) => a.localeCompare(b));
}

function formatAuditBlockedSkills(skills: string[]): string {
  if (skills.length === 0) return '- 未能从输出中解析具体 skill 名称';
  return skills.map((skill) => `- ${skill}`).join('\n');
}

function summarizeAuditWarning(result: RunResult): string {
  const output = `${result.stderr}\n${result.stdout}`;
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const summary = lines.find((line) => line.includes('audit findings across'));
  const highRisk = lines.find((line) => line.includes('skills with HIGH/CRITICAL findings'));
  const blocked = lines.find((line) => line.includes('Blocked:'));
  return [summary, highRisk, blocked].filter((line): line is string => Boolean(line)).join('\n');
}

function buildPartialUpdateContent(changedRepos: ChangedRepo[], auditBlocked: AuditBlockedUpdate): string {
  const auditSummary = summarizeAuditWarning(auditBlocked.result);
  return [
    '同步结果：成功（有审计警告）。',
    '',
    buildUpdateContent(changedRepos),
    '',
    '第一遍 `skillshare update --all` 发现安全审计警告，已记录后用 `--skip-audit` 重试并完成同步。',
    '',
    '出现审计警告的 skill：',
    formatAuditBlockedSkills(auditBlocked.skills),
    ...(auditSummary ? ['', '审计摘要：', '```', auditSummary, '```'] : []),
  ].join('\n');
}

function buildAuditBlockedContent(auditBlocked: AuditBlockedUpdate): string {
  const auditSummary = summarizeAuditWarning(auditBlocked.result);
  return [
    '同步结果：成功（有审计警告）。',
    '',
    '第一遍 `skillshare update --all` 发现安全审计警告，已记录后用 `--skip-audit` 重试。',
    '',
    '出现审计警告的 skill：',
    formatAuditBlockedSkills(auditBlocked.skills),
    ...(auditSummary ? ['', '审计摘要：', '```', auditSummary, '```'] : []),
  ].join('\n');
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
  const preservedGitignores = await readSkillshareGitignoreFiles(config.skillshareRoot);
  const previousConfigSnapshot = await readPreviousConfigSnapshot(config.stateFile);
  const beforeConfigSnapshot = await collectSyncConfigSnapshot(config.skillshareRoot);
  const persistedConfigChanged = previousConfigSnapshot !== undefined
    && !isSameConfigSnapshot(previousConfigSnapshot, beforeConfigSnapshot);
  try {
    const restore = await ensureTrackedReposInstalled(config, deps, preservedMetadata, preservedGitignores);
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
    let sourceLayoutChanged = await restoreSkillshareState(config.skillshareRoot, preservedMetadata, preservedGitignores);
    let auditBlocked: AuditBlockedUpdate | undefined;
    if (isContinuableUpdateFailure(update)) {
      auditBlocked = {
        result: update,
        skills: extractAuditBlockedSkills(update),
      };
      const retry = await deps.runCommand('skillshare', ['update', '--all', '--skip-audit'], config.skillshareRoot);
      sourceLayoutChanged = (await restoreSkillshareState(config.skillshareRoot, preservedMetadata, preservedGitignores)) || sourceLayoutChanged;
      if (retry.code !== 0) {
        const reason = compactOutput(retry);
        await maybeNotify(config, deps, {
          title: 'Skillshare 同步失败',
          content: [
            buildFailureContent('skillshare update --all --skip-audit', retry),
            '',
            '第一遍审计阻塞的 skill：',
            formatAuditBlockedSkills(auditBlocked.skills),
          ].join('\n'),
          level: 'warn',
        });
        return { status: 'failed', reason };
      }
    } else if (update.code !== 0) {
      const reason = compactOutput(update);
      await maybeNotify(config, deps, {
        title: 'Skillshare 同步失败',
        content: buildFailureContent('skillshare update --all', update),
        level: 'warn',
      });
      return { status: 'failed', reason };
    }

    const after = await deps.getSnapshot(config.skillshareRoot);
    const afterConfigSnapshot = await collectSyncConfigSnapshot(config.skillshareRoot);
    const configChanged = persistedConfigChanged || !isSameConfigSnapshot(beforeConfigSnapshot, afterConfigSnapshot);
    const changedRepos = detectChangedRepos(before, after);
    if (changedRepos.length === 0 && !sourceLayoutChanged && !configChanged) {
      if (auditBlocked) {
        await maybeNotify(config, deps, {
          title: 'Skillshare 同步成功（有审计警告）',
          content: buildAuditBlockedContent(auditBlocked),
          level: 'warn',
        });
      }
      deps.log(`[${new Date().toISOString()}] skillshare-sync-notify: no updates`);
      await writeConfigSnapshotState(config.stateFile, afterConfigSnapshot);
      return { status: 'unchanged' };
    }

    const sync = await deps.runCommand('skillshare', ['sync', '--all'], config.skillshareRoot);
    await restoreSkillshareState(config.skillshareRoot, preservedMetadata, preservedGitignores);
    const finalConfigSnapshot = await collectSyncConfigSnapshot(config.skillshareRoot);
    if (sync.code !== 0) {
      const reason = compactOutput(sync);
      await maybeNotify(config, deps, {
        title: 'Skillshare 同步失败',
        content: buildFailureContent('skillshare sync --all', sync),
        level: 'warn',
      });
      return { status: 'failed', reason };
    }
    await writeConfigSnapshotState(config.stateFile, finalConfigSnapshot);

    await maybeNotify(config, deps, {
      title: auditBlocked ? 'Skillshare 同步成功（有审计警告）' : 'Skillshare 有更新',
      content: auditBlocked ? buildPartialUpdateContent(changedRepos, auditBlocked) : buildUpdateContent(changedRepos),
      level: auditBlocked ? 'warn' : 'info',
    });
    deps.log(
      `[${new Date().toISOString()}] skillshare-sync-notify: synced ${changedRepos.length} updated sources`
      + (auditBlocked ? ' after skip-audit retry' : '')
    );
    return { status: 'updated', changedRepos };
  } finally {
    await restoreSkillshareState(config.skillshareRoot, preservedMetadata, preservedGitignores);
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
  const subdirSkills = await collectGithubSubdirSkillRoots(root);
  const repos = trackedRoots.length > 0 || subdirSkills.length > 0 ? trackedRoots : await findGitRepos(root);
  const snapshot = new Map<string, string>();
  for (const repo of repos) {
    const head = await command('git', ['rev-parse', 'HEAD'], repo);
    if (head.code === 0) {
      const status = await command('git', ['status', '--porcelain=v1'], repo);
      snapshot.set(repo, [head.stdout.trim(), status.code === 0 ? status.stdout.trim() : ''].join('\n'));
    }
  }
  for (const skill of subdirSkills) {
    snapshot.set(skill.path, await hashGithubSubdirSkill(skill));
  }
  return snapshot;
}

interface SkillshareMetadata {
  entries?: Record<string, SkillshareMetadataEntry | undefined>;
}

interface SkillshareMetadataEntry {
  tracked?: unknown;
  source?: unknown;
  branch?: unknown;
  type?: unknown;
  repo_url?: unknown;
  subdir?: unknown;
  version?: unknown;
  tree_hash?: unknown;
  file_hashes?: unknown;
}

interface TrackedMetadataFile {
  path: string;
  text: string;
  installs: SkillshareInstallSpec[];
  subdirSkills: SkillshareSubdirSpec[];
}

interface PreservedTextFile {
  path: string;
  text: string;
}

interface SkillshareInstallSpec {
  name: string;
  source: string;
  branch?: string;
}

interface SkillshareSubdirSpec {
  name: string;
  path: string;
  entry: SkillshareMetadataEntry;
}

function isGithubSubdirEntry(entry: SkillshareMetadataEntry | undefined): entry is SkillshareMetadataEntry {
  return entry?.type === 'github-subdir';
}

function hasSyncableMetadataEntry(metadata: SkillshareMetadata | null): boolean {
  return Object.values(metadata?.entries ?? {}).some((entry) => entry?.tracked === true || isGithubSubdirEntry(entry));
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

function githubSubdirMetadataSpecs(root: string, metadata: SkillshareMetadata | null): SkillshareSubdirSpec[] {
  const skillsDir = path.join(root, 'skills');
  const skills: SkillshareSubdirSpec[] = [];
  for (const [key, entry] of Object.entries(metadata?.entries ?? {})) {
    if (!isGithubSubdirEntry(entry)) continue;
    skills.push({
      name: key,
      path: path.join(skillsDir, key),
      entry,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function readTrackedMetadataFile(root: string): Promise<TrackedMetadataFile | undefined> {
  const metadataFiles = ['.metadata.json', 'meta.json'];
  for (const metadataFile of metadataFiles) {
    try {
      const metadataPath = path.join(root, 'skills', metadataFile);
      const text = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(text) as SkillshareMetadata | null;
      return {
        path: metadataPath,
        text,
        installs: trackedMetadataInstallSpecs(metadata),
        subdirSkills: githubSubdirMetadataSpecs(root, metadata),
      };
    } catch {
      // Try the next metadata filename.
    }
  }
  return undefined;
}

async function restoreMetadataFile(metadata: TrackedMetadataFile | undefined): Promise<void> {
  if (!metadata) return;
  if (metadata.subdirSkills.length === 0) {
    await fs.writeFile(metadata.path, metadata.text);
    return;
  }

  let preserved: SkillshareMetadata;
  let current: SkillshareMetadata;
  try {
    preserved = JSON.parse(metadata.text) as SkillshareMetadata;
    current = JSON.parse(await fs.readFile(metadata.path, 'utf8')) as SkillshareMetadata;
  } catch {
    await fs.writeFile(metadata.path, metadata.text);
    return;
  }

  current.entries = current.entries ?? {};
  for (const [key, entry] of Object.entries(preserved.entries ?? {})) {
    if (!entry) continue;
    if (isGithubSubdirEntry(entry)) {
      current.entries[key] = current.entries[key] ?? entry;
    } else {
      current.entries[key] = entry;
    }
  }

  await fs.writeFile(metadata.path, `${JSON.stringify(current, null, 2)}\n`);
}

async function restoreSkillshareState(
  root: string,
  metadata: TrackedMetadataFile | undefined,
  gitignores: PreservedTextFile[]
): Promise<boolean> {
  await restoreMetadataFile(metadata);
  const sourceLayoutChanged = await reconcileTrackedRepoDirs(root, metadata);
  await restoreTextFiles(gitignores);
  return sourceLayoutChanged;
}

async function isTrackedRepoInstalled(root: string, install: SkillshareInstallSpec): Promise<boolean> {
  try {
    await fs.access(path.join(root, 'skills', install.name, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function readSkillshareGitignoreFiles(root: string): Promise<PreservedTextFile[]> {
  const files: PreservedTextFile[] = [];
  for (const sourceDir of ['skills', 'agents']) {
    const filePath = path.join(root, sourceDir, '.gitignore');
    try {
      files.push({ path: filePath, text: await fs.readFile(filePath, 'utf8') });
    } catch {
      // Missing gitignore files do not need preservation.
    }
  }
  return files;
}

async function restoreTextFiles(files: PreservedTextFile[]): Promise<void> {
  for (const file of files) {
    try {
      const current = await fs.readFile(file.path, 'utf8');
      if (current === file.text) continue;
    } catch {
      // Recreate the preserved file if skillshare removed it.
    }
    await fs.writeFile(file.path, file.text);
  }
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function collectSyncConfigSnapshot(root: string): Promise<ConfigSnapshot> {
  const snapshot: ConfigSnapshot = {};
  for (const relativePath of SYNC_CONFIG_RELATIVE_PATHS) {
    try {
      snapshot[relativePath] = hashText(await fs.readFile(path.join(root, relativePath), 'utf8'));
    } catch {
      snapshot[relativePath] = 'missing';
    }
  }
  return snapshot;
}

function isSameConfigSnapshot(a: ConfigSnapshot, b: ConfigSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

async function readPreviousConfigSnapshot(stateFile: string | undefined): Promise<ConfigSnapshot | undefined> {
  if (!stateFile) return undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, 'utf8')) as SkillshareSyncState | null;
    return parsed?.configSnapshot && typeof parsed.configSnapshot === 'object'
      ? parsed.configSnapshot
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeConfigSnapshotState(stateFile: string | undefined, configSnapshot: ConfigSnapshot): Promise<void> {
  if (!stateFile) return;
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const state: SkillshareSyncState = {
    updatedAt: new Date().toISOString(),
    configSnapshot,
  };
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function normalizeRepoUrl(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^https?:\/\/github\.com\//i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

async function readOriginUrl(repoPath: string): Promise<string | undefined> {
  try {
    const config = await fs.readFile(path.join(repoPath, '.git', 'config'), 'utf8');
    const match = config.match(/^\s*url\s*=\s*(.+?)\s*$/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function isGitWorktreeClean(repoPath: string): Promise<boolean> {
  const result = await runCommand('git', ['status', '--porcelain=v1'], repoPath);
  return result.code === 0 && result.stdout.trim() === '';
}

async function reconcileTrackedRepoDirs(root: string, metadata: TrackedMetadataFile | undefined): Promise<boolean> {
  if (!metadata) return false;

  const skillsDir = path.join(root, 'skills');
  const installsByName = new Map(metadata.installs.map((install) => [install.name, install]));
  const installsByUrl = new Map(metadata.installs.map((install) => [normalizeRepoUrl(install.source), install]));
  let changed = false;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || installsByName.has(entry.name)) continue;
    const repoPath = path.join(skillsDir, entry.name);
    const originUrl = await readOriginUrl(repoPath);
    if (!originUrl) continue;

    const install = installsByUrl.get(normalizeRepoUrl(originUrl));
    if (!install) continue;

    const expectedPath = path.join(skillsDir, install.name);
    const expectedExists = await fs.access(path.join(expectedPath, '.git')).then(() => true, () => false);
    if (!await isGitWorktreeClean(repoPath)) continue;

    if (expectedExists) {
      await fs.rm(repoPath, { recursive: true, force: true });
      changed = true;
    } else {
      await fs.rename(repoPath, expectedPath);
      changed = true;
    }
  }

  for (const install of metadata.installs) {
    const skillPath = path.join(root, 'skills', install.name);
    const agentPath = path.join(root, 'agents', install.name);
    const skillExists = await fs.access(path.join(skillPath, '.git')).then(() => true, () => false);
    if (skillExists) continue;

    const agentOriginUrl = await readOriginUrl(agentPath);
    if (!agentOriginUrl || normalizeRepoUrl(agentOriginUrl) !== normalizeRepoUrl(install.source)) continue;
    if (!(await isGitWorktreeClean(agentPath))) continue;
    await fs.rm(agentPath, { recursive: true, force: true });
    changed = true;
  }
  return changed;
}

async function ensureTrackedReposInstalled(
  config: SkillshareSyncConfig,
  deps: SkillshareSyncDeps,
  metadata: TrackedMetadataFile | undefined,
  gitignores: PreservedTextFile[]
): Promise<RunResult> {
  if (!metadata || metadata.installs.length === 0) {
    return { code: 0, stdout: '', stderr: '' };
  }

  let stdout = '';
  let stderr = '';
  for (const install of metadata.installs) {
    if (await isTrackedRepoInstalled(config.skillshareRoot, install)) continue;
    const args = ['install', install.source, '--track', '--kind', 'skill'];
    if (install.branch) {
      args.push('--branch', install.branch);
    }
    args.push('--name', install.name.replace(/^_+/, ''), '--force');
    const result = await deps.runCommand('skillshare', args, config.skillshareRoot);
    await restoreSkillshareState(config.skillshareRoot, metadata, gitignores);
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
        if (hasSyncableMetadataEntry(JSON.parse(text) as SkillshareMetadata | null)) {
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

async function collectGithubSubdirSkillRoots(root: string): Promise<SkillshareSubdirSpec[]> {
  const metadata = await readTrackedMetadataFile(root);
  if (!metadata) return [];

  const skills: SkillshareSubdirSpec[] = [];
  for (const skill of metadata.subdirSkills) {
    try {
      const stat = await fs.stat(skill.path);
      if (stat.isDirectory()) {
        skills.push(skill);
      }
    } catch {
      // Missing single-skill installs can be restored by skillshare update; skip them before that happens.
    }
  }
  return skills.sort((a, b) => a.path.localeCompare(b.path));
}

function fingerprintGithubSubdirEntry(entry: SkillshareMetadataEntry): Record<string, unknown> {
  return {
    source: entry.source,
    repo_url: entry.repo_url,
    subdir: entry.subdir,
    version: entry.version,
    tree_hash: entry.tree_hash,
    file_hashes: entry.file_hashes,
  };
}

async function hashGithubSubdirSkill(skill: SkillshareSubdirSpec): Promise<string> {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(fingerprintGithubSubdirEntry(skill.entry)));

  async function visit(dir: string, relativeDir = ''): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue;
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        await visit(absolutePath, relativePath);
      } else if (entry.isSymbolicLink()) {
        hash.update(`link:${relativePath}:${await fs.readlink(absolutePath)}\n`);
      } else if (entry.isFile()) {
        hash.update(`file:${relativePath}:`);
        hash.update(await fs.readFile(absolutePath));
        hash.update('\n');
      }
    }
  }

  await visit(skill.path);
  return `${hash.digest('hex')}\n`;
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
  timeoutMs = readCommandTimeoutMs()
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        timedOut: timedOut || undefined,
        timeoutMs: timedOut ? timeoutMs : undefined,
        signal,
      });
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

function resolveStateFile(env: NodeJS.ProcessEnv): string | undefined {
  if (env.SKILLSHARE_SYNC_DISABLE_STATE === '1') return undefined;
  if (env.SKILLSHARE_SYNC_STATE_FILE) {
    return path.resolve(env.SKILLSHARE_SYNC_STATE_FILE);
  }
  const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'node-scripts', 'skillshare-sync-notify.json');
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
    stateFile: resolveStateFile(env),
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
