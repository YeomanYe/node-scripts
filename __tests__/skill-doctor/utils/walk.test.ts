import * as path from 'path';
import { findSkillMds, findShellScripts } from '../../../src/skill-doctor/utils/walk';

const FIXTURE = path.join(__dirname, '../fixtures/clean');

describe('walk', () => {
  it('finds all SKILL.md files under root', async () => {
    const files = await findSkillMds(FIXTURE);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.every((f) => f.endsWith('/SKILL.md'))).toBe(true);
  });

  it('finds shell scripts', async () => {
    const files = await findShellScripts(FIXTURE);
    expect(files.every((f) => f.endsWith('.sh') || f.endsWith('.bash'))).toBe(true);
  });
});
