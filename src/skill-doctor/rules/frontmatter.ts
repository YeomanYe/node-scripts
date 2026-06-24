import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';
import { parseFrontmatter } from '../utils/frontmatter';

export const DESCRIPTION_WARN = 800;
export const DESCRIPTION_ERROR = 1024;

export const frontmatterRule: Rule = {
  id: 'frontmatter',
  description: 'Validate SKILL.md frontmatter quality',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const { data } = parseFrontmatter(src);
      const rel = path.relative(ctx.root, skill.skillMdPath);
      const name = typeof data.name === 'string' ? data.name : undefined;
      const description = typeof data.description === 'string' ? data.description : undefined;

      if (!name) {
        findings.push({
          rule: 'frontmatter',
          level: 'error',
          skill: skill.name,
          file: rel,
          message: 'missing "name" field',
        });
      } else if (name !== skill.name) {
        findings.push({
          rule: 'frontmatter',
          level: 'warn',
          skill: skill.name,
          file: rel,
          message: `frontmatter name "${name}" does not match directory name "${skill.name}"`,
        });
      }

      if (!description) {
        findings.push({
          rule: 'frontmatter',
          level: 'error',
          skill: skill.name,
          file: rel,
          message: 'missing "description" field',
        });
      } else if (description.length > DESCRIPTION_ERROR) {
        findings.push({
          rule: 'frontmatter',
          level: 'error',
          skill: skill.name,
          file: rel,
          message: `description length ${description.length} exceeds ${DESCRIPTION_ERROR} (hard limit; likely truncated by Claude)`,
        });
      } else if (description.length > DESCRIPTION_WARN) {
        findings.push({
          rule: 'frontmatter',
          level: 'warn',
          skill: skill.name,
          file: rel,
          message: `description length ${description.length} exceeds ${DESCRIPTION_WARN} (soft limit; consider trimming)`,
        });
      }
    }
    return findings;
  },
};
