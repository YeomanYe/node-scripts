import * as path from 'path';
import { directorMetaSpecRule } from '../../../src/skill-doctor/rules/director-meta-spec';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/director-meta-spec');
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('director-meta-spec rule', () => {
  it('passes director skills with all required meta sections', async () => {
    const ctx = await buildCtx();
    const findings = await directorMetaSpecRule.run(ctx);
    expect(findings.filter((finding) => finding.skill === 'director-good')).toEqual([]);
  });

  it('flags a missing Aggregate to Verdict mapping', async () => {
    const ctx = await buildCtx();
    const findings = await directorMetaSpecRule.run(ctx);
    const verdictFindings = findings.filter((finding) => finding.skill === 'director-bad-no-verdict');
    expect(verdictFindings).toHaveLength(1);
    expect(verdictFindings[0]).toMatchObject({
      rule: 'director-meta-spec',
      level: 'error',
      message: 'Missing required section: Aggregate to Verdict mapping. See _shared/director-template.md for spec',
    });
  });

  it('flags a missing Step 0 Question Gate marker', async () => {
    const ctx = await buildCtx();
    const findings = await directorMetaSpecRule.run(ctx);
    const qgateFindings = findings.filter((finding) => finding.skill === 'director-bad-no-qgate');
    expect(qgateFindings).toHaveLength(1);
    expect(qgateFindings[0].message).toContain('Step 0 Question Gate');
  });

  it('skips non-director skills', async () => {
    const ctx = await buildCtx();
    const findings = await directorMetaSpecRule.run(ctx);
    expect(findings.some((finding) => finding.skill === 'regular-skill')).toBe(false);
  });
});
