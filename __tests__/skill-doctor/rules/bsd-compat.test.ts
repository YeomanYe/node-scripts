import * as path from 'path';
import { bsdCompatRule } from '../../../src/skill-doctor/rules/bsd-compat';
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

describe('bsd-compat rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('errors on grep -P', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings.some((f) => f.level === 'error' && /grep\s+-P/.test(f.message))).toBe(true);
  });

  it('warns on \\s usage', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings.some((f) => f.level === 'warn' && f.message.includes('\\s'))).toBe(true);
  });

  it('skips comment lines', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    const commentLine = findings.find((f) => f.line === 2);
    expect(commentLine).toBeUndefined();
  });
});
