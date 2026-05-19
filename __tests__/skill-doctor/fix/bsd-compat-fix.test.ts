import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { bsdCompatFixer } from '../../../src/skill-doctor/fix/bsd-compat-fix';
import type { FixerContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function copyFixture(name: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `skill-doctor-${name}-`));
  const source = path.join(__dirname, '../fixtures/fix', name, 'before');
  await fs.cp(source, tmp, { recursive: true });
  return tmp;
}

async function buildCtx(root: string): Promise<FixerContext> {
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((skillMdPath) => ({
    name: path.basename(path.dirname(skillMdPath)),
    dir: path.dirname(skillMdPath),
    skillMdPath,
  }));
  return { root, skills };
}

describe('bsd-compat fixer', () => {
  it('reports portable regex replacements without changing files in dry-run', async () => {
    const root = await copyFixture('bsd-compat');
    const script = path.join(root, 'example-skill', 'scripts', 'check.sh');
    const before = await fs.readFile(script, 'utf8');

    const result = await bsdCompatFixer.fix(await buildCtx(root), true);

    expect(result.errors).toEqual([]);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.map((action) => action.description)).toEqual([
      'replace \\s with [[:space:]] at line 3',
      'replace \\d with [0-9] at line 4',
    ]);
    await expect(fs.readFile(script, 'utf8')).resolves.toBe(before);
  });

  it('applies portable regex replacements while preserving comments and grep -P lines', async () => {
    const root = await copyFixture('bsd-compat');
    const expected = await fs.readFile(
      path.join(__dirname, '../fixtures/fix/bsd-compat/expected/example-skill/scripts/check.sh'),
      'utf8',
    );
    const script = path.join(root, 'example-skill', 'scripts', 'check.sh');

    const result = await bsdCompatFixer.fix(await buildCtx(root), false);

    expect(result.errors).toEqual([]);
    expect(result.actions).toHaveLength(2);
    await expect(fs.readFile(script, 'utf8')).resolves.toBe(expected);
  });
});
