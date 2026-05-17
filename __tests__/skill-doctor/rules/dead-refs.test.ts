import * as path from 'path';
import { deadRefsRule } from '../../../src/skill-doctor/rules/dead-refs';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('dead-refs rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await deadRefsRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('flags missing references with error level', async () => {
    const ctx = await buildCtx('bad-refs');
    const findings = await deadRefsRule.run(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.level === 'error')).toBe(true);
    expect(findings.some((f) => f.message.includes('missing.md'))).toBe(true);
    expect(findings.some((f) => f.message.includes('also-missing.sh'))).toBe(true);
  });
});
