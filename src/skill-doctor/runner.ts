import * as path from 'path';
import { bsdCompatRule } from './rules/bsd-compat';
import { callableOnlyLeafRule } from './rules/callable-only-leaf';
import { deadRefsRule } from './rules/dead-refs';
import { directorMetaSpecRule } from './rules/director-meta-spec';
import { fileSizeRule } from './rules/file-size';
import { frontmatterRule } from './rules/frontmatter';
import { readmeIndexRule } from './rules/readme-index';
import { routerCoverageRule } from './rules/router-coverage';
import { sharedDriftRule } from './rules/shared-drift';
import type { Finding, Rule, RunReport, SkillEntry } from './types';
import { findSkillMds } from './utils/walk';

const ALL_RULES: Rule[] = [
  deadRefsRule,
  frontmatterRule,
  bsdCompatRule,
  sharedDriftRule,
  readmeIndexRule,
  directorMetaSpecRule,
  routerCoverageRule,
  fileSizeRule,
  callableOnlyLeafRule,
];

export interface RunOptions {
  root: string;
  ruleIds?: string[];
}

async function buildSkills(root: string): Promise<SkillEntry[]> {
  const skillMds = await findSkillMds(root);
  return skillMds.map((skillMdPath) => ({
    name: path.basename(path.dirname(skillMdPath)),
    dir: path.dirname(skillMdPath),
    skillMdPath,
  }));
}

function countFindings(findings: Finding[]): RunReport['counts'] {
  return {
    error: findings.filter((finding) => finding.level === 'error').length,
    warn: findings.filter((finding) => finding.level === 'warn').length,
    info: findings.filter((finding) => finding.level === 'info').length,
  };
}

export async function runDoctor(opts: RunOptions): Promise<RunReport> {
  const startedAt = new Date();
  const rules = opts.ruleIds
    ? ALL_RULES.filter((rule) => opts.ruleIds?.includes(rule.id))
    : ALL_RULES;
  const skills = await buildSkills(opts.root);
  const ctx = { root: opts.root, skills };
  const findings: Finding[] = [];

  for (const rule of rules) {
    try {
      findings.push(...await rule.run(ctx));
    } catch (err) {
      findings.push({
        rule: rule.id,
        level: 'error',
        skill: '<runner>',
        message: `rule crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    root: opts.root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    rulesRun: rules.map((rule) => rule.id),
    findings,
    counts: countFindings(findings),
  };
}
