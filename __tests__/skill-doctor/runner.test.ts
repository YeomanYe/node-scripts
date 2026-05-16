import * as path from 'path';
import { runDoctor } from '../../src/skill-doctor/runner';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('runDoctor', () => {
  it('returns 0 findings on clean fixture', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'clean') });
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ error: 0, warn: 0, info: 0 });
    expect(report.rulesRun).toEqual(expect.arrayContaining(['dead-refs', 'frontmatter', 'bsd-compat', 'shared-drift']));
  });

  it('flags errors on bad-refs fixture', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'bad-refs') });
    expect(report.counts.error).toBeGreaterThanOrEqual(2);
  });

  it('honors ruleIds filter', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'bad-refs'), ruleIds: ['frontmatter'] });
    expect(report.rulesRun).toEqual(['frontmatter']);
    expect(report.findings.every((finding) => finding.rule === 'frontmatter')).toBe(true);
  });
});
