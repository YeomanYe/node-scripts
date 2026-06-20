import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

interface RequiredMarker {
  name: string;
  pattern: RegExp;
}

const REQUIRED_MARKERS: RequiredMarker[] = [
  { name: 'Step 0 Question Gate', pattern: /Step 0.*Question Gate/s },
  { name: 'N-dim Audit', pattern: /## .*维.*[Aa]udit|## .*Quality Audit/ },
  { name: 'Aggregate to Verdict mapping', pattern: /Aggregate.*Verdict/s },
  { name: 'Output Contract', pattern: /^## Output Contract/m },
  { name: 'Red Flags', pattern: /^## Red Flags/m },
  { name: 'Parallelization Plan', pattern: /^## Parallelization Plan/m },
  { name: 'Subagent Dispatch Template', pattern: /必须调用.*skill|必须显式 invoke/s },
  { name: 'Executor Selection', pattern: /^## Executor Selection/m },
  { name: 'Relationship to Other Skills', pattern: /^## Relationship/m },
];

export const directorMetaSpecRule: Rule = {
  id: 'director-meta-spec',
  description: 'Validate director-* skills include required meta-spec sections',
  async run(ctx) {
    const findings: Finding[] = [];

    for (const skill of ctx.skills) {
      if (!skill.name.startsWith('director-')) continue;

      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const rel = path.relative(ctx.root, skill.skillMdPath);
      for (const marker of REQUIRED_MARKERS) {
        if (marker.pattern.test(src)) continue;
        findings.push({
          rule: 'director-meta-spec',
          level: 'error',
          skill: skill.name,
          file: rel,
          message: `Missing required section: ${marker.name}. See _shared/director-template.md for spec`,
        });
      }
    }

    return findings;
  },
};
