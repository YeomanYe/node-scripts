import * as fs from 'fs/promises';
import * as path from 'path';
import type { FixAction, Fixer } from './types';
import { findShellScripts } from '../utils/walk';

const PCRE_PATTERN = /\b(?:grep|egrep)\s+-[a-zA-Z]*P/;
const SLASH_S = /\\s/g;
const SLASH_D = /\\d/g;
const COMMENT = /^\s*#/;

function replacePortableRegex(line: string): string {
  return line.replace(SLASH_S, '[[:space:]]').replace(SLASH_D, '[0-9]');
}

function describeReplacement(file: string, lineNumber: number, before: string, after: string): FixAction[] {
  const actions: FixAction[] = [];
  if (before.includes('\\s')) {
    actions.push({
      file,
      description: `replace \\s with [[:space:]] at line ${lineNumber}`,
      before,
      after,
    });
  }
  if (before.includes('\\d')) {
    actions.push({
      file,
      description: `replace \\d with [0-9] at line ${lineNumber}`,
      before,
      after,
    });
  }
  return actions;
}

export const bsdCompatFixer: Fixer = {
  id: 'bsd-compat',
  description: 'Replace portable shell regex tokens in scripts',
  async fix(ctx, dryRun) {
    const actions: FixAction[] = [];
    const errors: string[] = [];

    for (const skill of ctx.skills) {
      const scripts = await findShellScripts(skill.dir);
      for (const script of scripts) {
        let src: string;
        try {
          src = await fs.readFile(script, 'utf8');
        } catch (err) {
          errors.push(`${path.relative(ctx.root, script)}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        const rel = path.relative(ctx.root, script);
        const lines = src.split(/\r?\n/);
        let changed = false;
        const nextLines = lines.map((line, index) => {
          if (COMMENT.test(line) || PCRE_PATTERN.test(line)) return line;
          const next = replacePortableRegex(line);
          if (next !== line) {
            changed = true;
            actions.push(...describeReplacement(rel, index + 1, line, next));
          }
          return next;
        });

        if (!dryRun && changed) {
          try {
            await fs.writeFile(script, nextLines.join('\n'), 'utf8');
          } catch (err) {
            errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    return { fixer: 'bsd-compat', actions, errors };
  },
};
