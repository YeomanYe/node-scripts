import { renderJson } from '../../src/skill-doctor/reporters/json';
import { renderText } from '../../src/skill-doctor/reporters/text';
import type { RunReport } from '../../src/skill-doctor/types';

const REPORT: RunReport = {
  root: '/tmp/skills',
  startedAt: '2026-05-16T10:00:00.000Z',
  durationMs: 123,
  rulesRun: ['dead-refs', 'frontmatter'],
  findings: [
    { rule: 'dead-refs', level: 'error', skill: 'foo', file: 'foo/SKILL.md', line: 5, message: 'missing.md not found' },
    { rule: 'frontmatter', level: 'warn', skill: 'bar', file: 'bar/SKILL.md', message: 'description too long' },
  ],
  counts: { error: 1, warn: 1, info: 0 },
};

describe('renderText', () => {
  it('includes findings and summary', () => {
    const out = renderText(REPORT, { color: false });
    expect(out).toContain('ERROR');
    expect(out).toContain('foo/SKILL.md:5');
    expect(out).toContain('dead-refs');
    expect(out).toContain('missing.md not found');
    expect(out).toContain('Errors: 1');
    expect(out).toContain('Warnings: 1');
  });
});

describe('renderJson', () => {
  it('returns valid JSON of the report', () => {
    const out = renderJson(REPORT);
    expect(JSON.parse(out)).toEqual(REPORT);
  });
});
