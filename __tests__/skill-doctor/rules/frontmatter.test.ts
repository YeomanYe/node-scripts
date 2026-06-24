import * as path from 'path';
import {
  frontmatterRule,
  DESCRIPTION_WARN,
  DESCRIPTION_ERROR,
} from '../../../src/skill-doctor/rules/frontmatter';
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

  it(`warns on description > ${DESCRIPTION_WARN} chars (soft limit)`, async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(
      findings.some(
        (f) =>
          f.skill === 'desc-too-long' &&
          f.level === 'warn' &&
          f.message.includes(String(DESCRIPTION_WARN)),
      ),
    ).toBe(true);
  });

  it(`errors on description > ${DESCRIPTION_ERROR} chars (hard limit)`, async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(
      findings.some(
        (f) =>
          f.skill === 'desc-way-too-long' &&
          f.level === 'error' &&
          f.message.includes(String(DESCRIPTION_ERROR)),
      ),
    ).toBe(true);
  });

  it('does not double-fire warn when description exceeds hard limit', async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    // desc-way-too-long should ONLY emit error, not also warn
    const wayTooLongFindings = findings.filter((f) => f.skill === 'desc-way-too-long' && f.rule === 'frontmatter');
    const warns = wayTooLongFindings.filter((f) => f.level === 'warn');
    expect(warns).toHaveLength(0);
  });
});
