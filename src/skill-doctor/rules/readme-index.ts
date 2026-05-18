import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const HEADING_PATTERN = /^##\s+(.+)$/gm;
const IGNORED = new Set(['node_modules', '.git', '.claude', 'dist', '__tests__']);

function isExternalLink(target: string): boolean {
  return /^https?:\/\//.test(target);
}

function isAnchorLink(target: string): boolean {
  return /^#[A-Za-z0-9-]+$/.test(target);
}

function normalizeAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function getTopDir(target: string): string | undefined {
  if (target.startsWith('#') || target.startsWith('/')) return undefined;
  const clean = target.split('#')[0].split('?')[0];
  const parts = clean.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts[0] === '..') return undefined;
  return parts[0];
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findMarkdownFiles(dir: string, out: string[]): Promise<void> {
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
      await findMarkdownFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}

function getReadmeAnchors(src: string): Set<string> {
  const anchors = new Set<string>();
  let headingMatch: RegExpExecArray | null;
  HEADING_PATTERN.lastIndex = 0;
  while ((headingMatch = HEADING_PATTERN.exec(src)) !== null) {
    anchors.add(normalizeAnchor(headingMatch[1]));
  }
  return anchors;
}

export const readmeIndexRule: Rule = {
  id: 'readme-index',
  description: 'Detect README markdown links to missing skill directories',
  async run(ctx) {
    const findings: Finding[] = [];
    const markdownFiles: string[] = [];
    await findMarkdownFiles(ctx.root, markdownFiles);

    for (const markdownPath of markdownFiles) {
      let src: string;
      try {
        src = await fs.readFile(markdownPath, 'utf8');
      } catch {
        continue;
      }

      const rel = path.relative(ctx.root, markdownPath);
      const isRootReadme = rel === 'README.md';
      const anchors = isRootReadme ? getReadmeAnchors(src) : new Set<string>();
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        LINK_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = LINK_PATTERN.exec(line)) !== null) {
          const target = match[2].trim();
          if (isExternalLink(target)) continue;

          if (isRootReadme && isAnchorLink(target)) {
            const anchor = target.slice(1);
            if (!anchors.has(anchor)) {
              findings.push({
                rule: 'readme-index',
                level: 'error',
                skill: '<root>',
                file: rel,
                line: i + 1,
                message: `README anchor link ${target} has no matching section`,
              });
            }
            continue;
          }

          const topDir = getTopDir(target);
          if (!topDir) continue;

          const abs = path.join(path.dirname(markdownPath), topDir);
          if (!await existsDir(abs)) {
            findings.push({
              rule: 'readme-index',
              level: 'error',
              skill: '<root>',
              file: rel,
              line: i + 1,
              message: `Markdown link ${target} points to missing directory ${topDir}`,
            });
          }
        }
      }
    }

    return findings;
  },
};
