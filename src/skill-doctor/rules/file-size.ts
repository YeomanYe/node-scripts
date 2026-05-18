import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

export const MAX_LINES = 500;

function countLines(src: string): number {
  const trimmed = src.endsWith('\n') ? src.slice(0, -1) : src;
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\r?\n/).length;
}

export const fileSizeRule: Rule = {
  id: 'file-size',
  description: 'Warn when SKILL.md files exceed the recommended line count',
  async run(ctx) {
    const findings: Finding[] = [];

    for (const skill of ctx.skills) {
      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const lineCount = countLines(src);
      if (lineCount <= MAX_LINES) continue;

      findings.push({
        rule: 'file-size',
        level: 'warn',
        skill: skill.name,
        file: path.relative(ctx.root, skill.skillMdPath),
        message: `SKILL.md is ${lineCount} lines (>500); consider splitting into references/`,
      });
    }

    return findings;
  },
};
