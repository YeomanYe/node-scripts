import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';
import { parseFrontmatter } from '../utils/frontmatter';

const REF_PATTERN = /(?:`)?references\/([A-Za-z0-9_\-./]+)(?:`)?/g;

export const deadRefsRule: Rule = {
  id: 'dead-refs',
  description: 'Detect SKILL.md references to non-existent references/* files',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const { body } = parseFrontmatter(src);
      const seen = new Set<string>();
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        REF_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = REF_PATTERN.exec(line)) !== null) {
          const rel = match[1].replace(/[.,;:)]+$/, '');
          if (seen.has(rel)) continue;
          seen.add(rel);
          const abs = path.join(skill.dir, 'references', rel);
          try {
            await fs.access(abs);
          } catch {
            findings.push({
              rule: 'dead-refs',
              level: 'error',
              skill: skill.name,
              file: path.relative(ctx.root, skill.skillMdPath),
              line: i + 1,
              message: `references/${rel} not found at ${path.relative(ctx.root, abs)}`,
            });
          }
        }
      }
    }
    return findings;
  },
};
