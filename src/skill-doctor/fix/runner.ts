import * as path from 'path';
import { bsdCompatFixer } from './bsd-compat-fix';
import { sharedDriftFixer } from './shared-drift-fix';
import type { FixAction, Fixer, RunReport, SkillEntry } from '../types';
import { findSkillMds } from '../utils/walk';

export const ALL_FIXERS: Fixer[] = [
  bsdCompatFixer,
  sharedDriftFixer,
];

export interface FixRunOptions {
  root: string;
  ruleIds?: string[];
  dryRun: boolean;
}

async function buildSkills(root: string): Promise<SkillEntry[]> {
  const skillMds = await findSkillMds(root);
  return skillMds.map((skillMdPath) => ({
    name: path.basename(path.dirname(skillMdPath)),
    dir: path.dirname(skillMdPath),
    skillMdPath,
  }));
}

function selectFixers(ruleIds: string[] | undefined): Fixer[] {
  return ruleIds
    ? ALL_FIXERS.filter((fixer) => ruleIds.includes(fixer.id))
    : ALL_FIXERS;
}

export async function runFixers(opts: FixRunOptions): Promise<RunReport> {
  const startedAt = new Date();
  const fixers = selectFixers(opts.ruleIds);
  const skills = await buildSkills(opts.root);
  const ctx = { root: opts.root, skills };
  const fixesPending: FixAction[] = [];
  const fixesApplied: FixAction[] = [];
  const fixErrors: string[] = [];

  for (const fixer of fixers) {
    const result = await fixer.fix(ctx, opts.dryRun);
    if (opts.dryRun) {
      fixesPending.push(...result.actions.map((action) => ({ ...action, fixer: result.fixer })));
    } else {
      fixesApplied.push(...result.actions.map((action) => ({ ...action, fixer: result.fixer })));
    }
    fixErrors.push(...result.errors.map((error) => `${result.fixer}: ${error}`));
    if (!opts.dryRun && result.errors.length > 0) break;
  }

  return {
    root: opts.root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    rulesRun: [],
    findings: [],
    counts: { error: 0, warn: 0, info: 0 },
    fix_mode: opts.dryRun ? 'dry-run' : 'apply',
    fixers_ran: fixers.map((fixer) => fixer.id),
    fixes_pending: opts.dryRun ? fixesPending : [],
    fixes_applied: opts.dryRun ? [] : fixesApplied,
    fix_errors: fixErrors,
  };
}
