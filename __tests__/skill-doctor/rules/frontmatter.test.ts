import * as path from 'path';
import { frontmatterRule } from '../../../src/skill-doctor/rules/frontmatter';
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

describe('frontmatter rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await frontmatterRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('errors on missing name', async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(findings.some((f) => f.skill === 'no-name' && f.level === 'error' && f.message.includes('name'))).toBe(true);
  });

  it('warns on description > 250 chars', async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(findings.some((f) => f.skill === 'desc-too-long' && f.level === 'warn' && f.message.includes('250'))).toBe(true);
  });
});
