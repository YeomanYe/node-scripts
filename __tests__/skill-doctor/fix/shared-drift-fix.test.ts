import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { sharedDriftFixer } from '../../../src/skill-doctor/fix/shared-drift-fix';
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

describe('shared-drift fixer', () => {
  it('returns an error when sync-shared.sh is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-doctor-no-sync-'));

    const result = await sharedDriftFixer.fix(await buildCtx(root), true);

    expect(result.actions).toEqual([]);
    expect(result.errors).toEqual(['no sync-shared.sh found']);
  });

  it('reports the sync script without running it in dry-run', async () => {
    const root = await copyFixture('shared-drift');
    const marker = path.join(root, 'local', 'sync-ran.txt');

    const result = await sharedDriftFixer.fix(await buildCtx(root), true);

    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      {
        file: 'scripts/sync-shared.sh',
        description: 'would run sync-shared.sh',
      },
    ]);
    await expect(fs.stat(marker)).rejects.toThrow();
  });

  it('runs the executable sync script in apply mode', async () => {
    const root = await copyFixture('shared-drift');
    const script = path.join(root, 'scripts', 'sync-shared.sh');
    await fs.chmod(script, 0o755);
    const expected = await fs.readFile(
      path.join(__dirname, '../fixtures/fix/shared-drift/expected/skill-a/references/template.md'),
      'utf8',
    );

    const result = await sharedDriftFixer.fix(await buildCtx(root), false);

    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      {
        file: 'scripts/sync-shared.sh',
        description: 'ran sync-shared.sh',
      },
    ]);
    await expect(fs.readFile(path.join(root, 'local', 'sync-ran.txt'), 'utf8')).resolves.toBe('ran\n');
    await expect(fs.readFile(path.join(root, 'skill-a', 'references', 'template.md'), 'utf8')).resolves.toBe(expected);
  });
});
