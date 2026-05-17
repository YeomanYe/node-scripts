import * as path from 'path';
import { sharedDriftRule } from '../../../src/skill-doctor/rules/shared-drift';
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

describe('shared-drift rule', () => {
  it('passes clean fixture (no _shared dir)', async () => {
    const ctx = await buildCtx('clean');
    const findings = await sharedDriftRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('warns when references/X.md hash differs from _shared/X.md', async () => {
    const ctx = await buildCtx('drift');
    const findings = await sharedDriftRule.run(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].level).toBe('warn');
    expect(findings[0].message).toContain('template.md');
    expect(findings[0].message.toLowerCase()).toContain('drift');
  });
});
