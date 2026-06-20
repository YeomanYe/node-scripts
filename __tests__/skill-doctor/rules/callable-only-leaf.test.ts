import * as path from 'path';
import { callableOnlyLeafRule } from '../../../src/skill-doctor/rules/callable-only-leaf';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/callable-only-leaf');
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('callable-only-leaf rule', () => {
  it('passes a leaf skill that declares the callable-only marker', async () => {
    const ctx = await buildCtx();
    const findings = await callableOnlyLeafRule.run(ctx);
    expect(findings.filter((f) => f.skill === 'change-recap')).toEqual([]);
  });

  it('warns a leaf skill missing the callable-only marker', async () => {
    const ctx = await buildCtx();
    const findings = await callableOnlyLeafRule.run(ctx);
    const f = findings.filter((x) => x.skill === 'clean-commit');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'callable-only-leaf', level: 'warn' });
  });

  it('skips non-leaf skills entirely', async () => {
    const ctx = await buildCtx();
    const findings = await callableOnlyLeafRule.run(ctx);
    expect(findings.some((f) => f.skill === 'regular-skill')).toBe(false);
  });
});
