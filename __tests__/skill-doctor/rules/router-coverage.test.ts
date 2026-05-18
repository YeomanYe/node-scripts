import * as path from 'path';
import { routerCoverageRule } from '../../../src/skill-doctor/rules/router-coverage';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures/router-coverage', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('router-coverage rule', () => {
  it('passes when role-router mentions all director skills', async () => {
    const ctx = await buildCtx('good');
    const findings = await routerCoverageRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('warns when a director skill is missing from role-router', async () => {
    const ctx = await buildCtx('missing-architect');
    const findings = await routerCoverageRule.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'router-coverage',
      level: 'warn',
      skill: 'director-architect',
      file: 'flow-codex-goal/references/role-router.md',
      message: 'director-architect not found in flow-codex-goal/references/role-router.md (router coverage gap)',
    });
  });

  it('skips roots without flow-codex-goal role-router', async () => {
    const ctx = await buildCtx('no-flow');
    const findings = await routerCoverageRule.run(ctx);
    expect(findings).toEqual([]);
  });
});
