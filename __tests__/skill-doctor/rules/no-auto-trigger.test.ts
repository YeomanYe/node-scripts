import * as path from 'path';
import { noAutoTriggerRule } from '../../../src/skill-doctor/rules/no-auto-trigger';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/no-auto-trigger');
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('no-auto-trigger rule', () => {
  it('passes a leaf skill (callable-only) that declares the no-auto-trigger phrase', async () => {
    const ctx = await buildCtx();
    const findings = await noAutoTriggerRule.run(ctx);
    expect(findings.filter((f) => f.skill === 'change-recap')).toEqual([]);
  });

  it('passes a top-level workflow (explicit-only) that declares the phrase', async () => {
    const ctx = await buildCtx();
    const findings = await noAutoTriggerRule.run(ctx);
    expect(findings.filter((f) => f.skill === 'flow-cron')).toEqual([]);
  });

  it('warns a tracked skill missing the no-auto-trigger phrase', async () => {
    const ctx = await buildCtx();
    const findings = await noAutoTriggerRule.run(ctx);
    const f = findings.filter((x) => x.skill === 'clean-commit');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'no-auto-trigger', level: 'warn' });
  });

  it('skips skills not in the tracked set', async () => {
    const ctx = await buildCtx();
    const findings = await noAutoTriggerRule.run(ctx);
    expect(findings.some((f) => f.skill === 'regular-skill')).toBe(false);
  });
});
