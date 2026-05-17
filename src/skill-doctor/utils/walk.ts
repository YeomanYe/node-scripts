import * as fs from 'fs/promises';
import * as path from 'path';

const IGNORED = new Set(['node_modules', '.git', '.claude', 'dist', '__tests__']);

async function walk(dir: string, predicate: (name: string) => boolean, out: string[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, predicate, out);
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(full);
    }
  }
}

export async function findSkillMds(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, (name) => name === 'SKILL.md', out);
  return out;
}

export async function findShellScripts(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, (name) => name.endsWith('.sh') || name.endsWith('.bash'), out);
  return out;
}
