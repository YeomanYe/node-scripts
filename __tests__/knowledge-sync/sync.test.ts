import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { applyKnowledgeSync, planKnowledgeSync } from '../../src/knowledge-sync/sync';

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
}

describe('knowledge-sync', () => {
  it('copies new and changed allowed files and skips ignored files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-sync-'));
    const sourceRoot = path.join(root, 'knowledge');
    const targetRoot = path.join(root, 'raw', 'sources', 'knowledge');
    const statePath = path.join(root, '.llm-wiki-sync-state.json');

    await fs.mkdir(path.join(sourceRoot, 'local'), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, 'note.md'), 'first\n', 'utf-8');
    await fs.writeFile(path.join(sourceRoot, 'local', '.env'), 'SECRET=1\n', 'utf-8');
    await fs.writeFile(path.join(sourceRoot, 'debug.log'), 'noise\n', 'utf-8');
    await fs.writeFile(path.join(sourceRoot, '.llm-wiki-syncignore'), 'local/**\n*.log\n', 'utf-8');

    const firstPlan = await planKnowledgeSync({ sourceRoot, targetRoot, statePath });
    expect(firstPlan.actions.map((a) => `${a.kind}:${a.relativePath}`)).toEqual(['copy:note.md']);

    const firstResult = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });
    expect(firstResult.summary).toEqual({ copied: 1, deleted: 0, skipped: 0 });
    await expect(fs.readFile(path.join(targetRoot, 'note.md'), 'utf-8')).resolves.toBe('first\n');
    await expect(exists(path.join(targetRoot, 'local', '.env'))).resolves.toBe(false);
    await expect(exists(path.join(targetRoot, 'debug.log'))).resolves.toBe(false);

    await fs.writeFile(path.join(sourceRoot, 'note.md'), 'second\n', 'utf-8');
    const secondResult = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });
    expect(secondResult.summary).toEqual({ copied: 1, deleted: 0, skipped: 0 });
    await expect(fs.readFile(path.join(targetRoot, 'note.md'), 'utf-8')).resolves.toBe('second\n');

    const thirdResult = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });
    expect(thirdResult.summary).toEqual({ copied: 0, deleted: 0, skipped: 1 });
  });

  it('deletes target files that were previously synced but removed from source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-sync-'));
    const sourceRoot = path.join(root, 'knowledge');
    const targetRoot = path.join(root, 'raw', 'sources', 'knowledge');
    const statePath = path.join(root, '.llm-wiki-sync-state.json');

    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, 'old.md'), 'old\n', 'utf-8');
    await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });

    await fs.rm(path.join(sourceRoot, 'old.md'));
    const result = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });

    expect(result.summary).toEqual({ copied: 0, deleted: 1, skipped: 0 });
    await expect(exists(path.join(targetRoot, 'old.md'))).resolves.toBe(false);
    await expect(readJson<{ files: Record<string, unknown> }>(statePath)).resolves.toMatchObject({ files: {} });
  });

  it('does not write files or state in dry-run mode', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-sync-'));
    const sourceRoot = path.join(root, 'knowledge');
    const targetRoot = path.join(root, 'raw', 'sources', 'knowledge');
    const statePath = path.join(root, '.llm-wiki-sync-state.json');

    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, 'draft.md'), 'draft\n', 'utf-8');

    const result = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: false });

    expect(result.summary).toEqual({ copied: 1, deleted: 0, skipped: 0 });
    await expect(exists(path.join(targetRoot, 'draft.md'))).resolves.toBe(false);
    await expect(exists(statePath)).resolves.toBe(false);
  });

  it('adopts matching target files as already synced when state is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-sync-'));
    const sourceRoot = path.join(root, 'knowledge');
    const targetRoot = path.join(root, 'raw', 'sources', 'knowledge');
    const statePath = path.join(root, '.llm-wiki-sync-state.json');

    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.mkdir(targetRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, 'existing.md'), 'same\n', 'utf-8');
    await fs.writeFile(path.join(targetRoot, 'existing.md'), 'same\n', 'utf-8');

    const result = await applyKnowledgeSync({ sourceRoot, targetRoot, statePath, apply: true });

    expect(result.summary).toEqual({ copied: 0, deleted: 0, skipped: 1 });
    const state = await readJson<{ files: Record<string, unknown> }>(statePath);
    expect(Object.keys(state.files)).toEqual(['existing.md']);
  });
});
