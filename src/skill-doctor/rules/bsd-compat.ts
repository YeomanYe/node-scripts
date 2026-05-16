import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';
import { findShellScripts } from '../utils/walk';

const PCRE_PATTERN = /\b(?:grep|egrep)\s+-[a-zA-Z]*P/;
const SLASH_S = /\\s/;
const SLASH_D = /\\d/;
const COMMENT = /^\s*#/;

export const bsdCompatRule: Rule = {
  id: 'bsd-compat',
  description: 'Detect BSD-incompatible regex/grep flags in shell scripts',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      const scripts = await findShellScripts(skill.dir);
      for (const script of scripts) {
        let src: string;
        try {
          src = await fs.readFile(script, 'utf8');
        } catch {
          continue;
        }

        const rel = path.relative(ctx.root, script);
        const lines = src.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (COMMENT.test(line)) continue;
          if (PCRE_PATTERN.test(line)) {
            findings.push({
              rule: 'bsd-compat',
              level: 'error',
              skill: skill.name,
              file: rel,
              line: i + 1,
              message: 'grep -P is not supported on BSD/macOS grep; use ERE or perl',
            });
          }
          if (SLASH_S.test(line)) {
            findings.push({
              rule: 'bsd-compat',
              level: 'warn',
              skill: skill.name,
              file: rel,
              line: i + 1,
              message: '\\s is not portable in BSD sed/awk/grep; use [[:space:]] instead',
            });
          }
          if (SLASH_D.test(line)) {
            findings.push({
              rule: 'bsd-compat',
              level: 'warn',
              skill: skill.name,
              file: rel,
              line: i + 1,
              message: '\\d is not portable in BSD sed/awk/grep; use [0-9] or [[:digit:]] instead',
            });
          }
        }
      }
    }
    return findings;
  },
};
