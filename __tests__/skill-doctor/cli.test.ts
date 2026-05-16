import * as path from 'path';
import { runMain } from '../../src/skill-doctor/index';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('cli runMain', () => {
  it('returns exit code 0 on clean fixture (json, notify off)', async () => {
    const { code, output } = await runMain([
      '--root', path.join(FIXTURES, 'clean'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report.counts).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('returns exit code 2 on bad-refs fixture', async () => {
    const { code } = await runMain([
      '--root', path.join(FIXTURES, 'bad-refs'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(2);
  });

  it('returns exit code 1 on warn-only fixture (drift)', async () => {
    const { code } = await runMain([
      '--root', path.join(FIXTURES, 'drift'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(1);
  });
});
