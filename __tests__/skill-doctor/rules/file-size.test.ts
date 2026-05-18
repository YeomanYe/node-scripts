import * as path from 'path';
import { fileSizeRule } from '../../../src/skill-doctor/rules/file-size';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/file-size', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('file-size rule', () => {
  it('passes a small SKILL.md', async () => {
    const ctx = await buildCtx('small');
    const findings = await fileSizeRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('does not warn at exactly 500 lines', async () => {
    const ctx = await buildCtx('exact');
    const findings = await fileSizeRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('warns over 500 lines', async () => {
    const ctx = await buildCtx('over');
    const findings = await fileSizeRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'file-size',
      level: 'warn',
      skill: 'skill-d',
    });
    expect(findings[0].message).toContain('501 lines');
  });

  it('reports the actual line count for a huge SKILL.md', async () => {
    const ctx = await buildCtx('huge');
    const findings = await fileSizeRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('600 lines');
  });
});
