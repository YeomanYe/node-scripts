import * as path from 'path';
import { readmeIndexRule } from '../../../src/skill-doctor/rules/readme-index';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/readme-index', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('readme-index rule', () => {
  it('passes existing skill directory links and ignores external URLs', async () => {
    const ctx = await buildCtx('good');
    const findings = await readmeIndexRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('flags missing skill directory links with error level', async () => {
    const ctx = await buildCtx('bad-dead-dir');
    const findings = await readmeIndexRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'readme-index',
      level: 'error',
      skill: '<root>',
    });
    expect(findings[0].message).toContain('gone-skill');
  });

  it('flags README anchor links without matching sections', async () => {
    const ctx = await buildCtx('bad-anchor');
    const findings = await readmeIndexRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('#gone-skill');
  });
});
