import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type SyncAction =
  | { kind: 'copy'; relativePath: string; sourcePath: string; targetPath: string; reason: 'new' | 'changed' }
  | { kind: 'delete'; relativePath: string; targetPath: string; reason: 'removed' };

export interface SyncedFileState {
  hash: string;
  size: number;
  mtimeMs: number;
  targetPath: string;
  lastSyncedAt: string;
}

export interface KnowledgeSyncState {
  version: 1;
  sourceRoot: string;
  targetRoot: string;
  files: Record<string, SyncedFileState>;
}

export interface KnowledgeSyncOptions {
  sourceRoot: string;
  targetRoot: string;
  statePath: string;
  ignorePath?: string;
  includeExtensions?: string[];
  apply?: boolean;
}

export interface KnowledgeSyncPlan {
  actions: SyncAction[];
  skipped: string[];
  state: KnowledgeSyncState;
  nextState: KnowledgeSyncState;
}

export interface KnowledgeSyncResult extends KnowledgeSyncPlan {
  summary: {
    copied: number;
    deleted: number;
    skipped: number;
  };
}

export const DEFAULT_SOURCE_ROOT = path.join(os.homedir(), 'Documents', 'knowledge');
export const DEFAULT_TARGET_ROOT = path.join(
  os.homedir(),
  'Documents',
  'llm-wiki-knowledge',
  'Llm-wiki-knowledge',
  'raw',
  'sources',
  'knowledge'
);
export const DEFAULT_STATE_FILE = '.llm-wiki-sync-state.json';
export const DEFAULT_IGNORE_FILE = '.llm-wiki-syncignore';

const DEFAULT_INCLUDE_EXTENSIONS = [
  'md',
  'mdx',
  'txt',
  'pdf',
  'doc',
  'docx',
  'pptx',
  'xls',
  'xlsx',
  'odt',
  'odp',
  'ods',
  'rtf',
  'html',
  'htm',
  'csv',
];

const BUILT_IN_IGNORE_PATTERNS = [
  '.git/**',
  '.svn/**',
  '.hg/**',
  '.stfolder/**',
  '.obsidian/**',
  '.idea/**',
  '.vscode/**',
  'node_modules/**',
  'local/**',
  '.DS_Store',
  DEFAULT_STATE_FILE,
  DEFAULT_IGNORE_FILE,
  '*.env',
  '.env',
  '*.log',
  '*.sh',
  '~$*',
  '.~lock.*#',
  '*.draft.*',
  'draft-*',
  '*.private.*',
  'research-log.txt',
  '*stock*research.md',
  '*zhongtai*research.md',
  '*kexin*research.md',
  '*suton*research.md',
  '*chuanyi*research.md',
];

interface SourceFileInfo {
  relativePath: string;
  absolutePath: string;
  hash: string;
  size: number;
  mtimeMs: number;
}

export function defaultStatePath(sourceRoot = DEFAULT_SOURCE_ROOT): string {
  return path.join(sourceRoot, DEFAULT_STATE_FILE);
}

export async function planKnowledgeSync(options: KnowledgeSyncOptions): Promise<KnowledgeSyncPlan> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const targetRoot = path.resolve(options.targetRoot);
  const statePath = path.resolve(options.statePath);
  const includeExtensions = normalizeExtensions(options.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS);
  const ignorePatterns = await loadIgnorePatterns(options.ignorePath ?? path.join(sourceRoot, DEFAULT_IGNORE_FILE));
  const state = await readState(statePath, sourceRoot, targetRoot);
  const sourceFiles = await listSourceFiles(sourceRoot, includeExtensions, ignorePatterns);
  const sourceByRel = new Map(sourceFiles.map((file) => [file.relativePath, file]));

  const actions: SyncAction[] = [];
  const skipped: string[] = [];
  const nextState: KnowledgeSyncState = {
    version: 1,
    sourceRoot,
    targetRoot,
    files: {},
  };

  for (const file of sourceFiles) {
    const previous = state.files[file.relativePath];
    const targetPath = path.join(targetRoot, fromPosixPath(file.relativePath));
    if (previous?.hash === file.hash || (!previous && await targetHasHash(targetPath, file.hash))) {
      skipped.push(file.relativePath);
    } else {
      actions.push({
        kind: 'copy',
        relativePath: file.relativePath,
        sourcePath: file.absolutePath,
        targetPath,
        reason: previous ? 'changed' : 'new',
      });
    }

    nextState.files[file.relativePath] = {
      hash: file.hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      targetPath: file.relativePath,
      lastSyncedAt: previous?.lastSyncedAt ?? '',
    };
  }

  for (const [relativePath, previous] of Object.entries(state.files)) {
    if (sourceByRel.has(relativePath)) continue;
    actions.push({
      kind: 'delete',
      relativePath,
      targetPath: path.join(targetRoot, fromPosixPath(previous.targetPath || relativePath)),
      reason: 'removed',
    });
  }

  return { actions, skipped, state, nextState };
}

async function targetHasHash(targetPath: string, hash: string): Promise<boolean> {
  try {
    return await sha256File(targetPath) === hash;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return false;
    throw error;
  }
}

export async function applyKnowledgeSync(options: KnowledgeSyncOptions & { apply: boolean }): Promise<KnowledgeSyncResult> {
  const plan = await planKnowledgeSync(options);
  const copied = plan.actions.filter((action) => action.kind === 'copy').length;
  const deleted = plan.actions.filter((action) => action.kind === 'delete').length;
  const now = new Date().toISOString();

  if (options.apply) {
    for (const action of plan.actions) {
      if (action.kind === 'copy') {
        await fs.mkdir(path.dirname(action.targetPath), { recursive: true });
        await fs.copyFile(action.sourcePath, action.targetPath);
        const file = plan.nextState.files[action.relativePath];
        if (file) file.lastSyncedAt = now;
      } else {
        await fs.rm(action.targetPath, { force: true });
      }
    }

    for (const relativePath of plan.skipped) {
      const file = plan.nextState.files[relativePath];
      if (file && !file.lastSyncedAt) file.lastSyncedAt = now;
    }

    await writeState(options.statePath, plan.nextState);
  }

  return {
    ...plan,
    summary: {
      copied,
      deleted,
      skipped: plan.skipped.length,
    },
  };
}

async function readState(statePath: string, sourceRoot: string, targetRoot: string): Promise<KnowledgeSyncState> {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as KnowledgeSyncState;
    return {
      version: 1,
      sourceRoot: path.resolve(parsed.sourceRoot || sourceRoot),
      targetRoot: path.resolve(parsed.targetRoot || targetRoot),
      files: parsed.files || {},
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') throw error;
    return {
      version: 1,
      sourceRoot,
      targetRoot,
      files: {},
    };
  }
}

async function writeState(statePath: string, state: KnowledgeSyncState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

async function loadIgnorePatterns(ignorePath: string): Promise<string[]> {
  let custom: string[] = [];
  try {
    const raw = await fs.readFile(ignorePath, 'utf-8');
    custom = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') throw error;
  }
  return [...BUILT_IN_IGNORE_PATTERNS, ...custom];
}

async function listSourceFiles(
  sourceRoot: string,
  includeExtensions: Set<string>,
  ignorePatterns: string[]
): Promise<SourceFileInfo[]> {
  const files: SourceFileInfo[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toPosixPath(path.relative(sourceRoot, absolutePath));
      if (!relativePath || isIgnored(relativePath, ignorePatterns)) continue;

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase();
      if (!includeExtensions.has(ext)) continue;

      const stat = await fs.stat(absolutePath);
      files.push({
        relativePath,
        absolutePath,
        hash: await sha256File(absolutePath),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  await visit(sourceRoot);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function normalizeExtensions(extensions: string[]): Set<string> {
  return new Set(extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()).filter(Boolean));
}

function isIgnored(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(relativePath, pattern));
}

function matchPattern(relativePath: string, pattern: string): boolean {
  const normalized = toPosixPath(pattern).replace(/^\//, '');
  const basename = relativePath.split('/').pop() ?? relativePath;

  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }

  if (!normalized.includes('/')) {
    return globToRegExp(normalized).test(basename);
  }

  return globToRegExp(normalized).test(relativePath);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += escapeRegExp(char);
    }
  }
  source += '$';
  return new RegExp(source);
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function fromPosixPath(value: string): string {
  return value.split('/').join(path.sep);
}
