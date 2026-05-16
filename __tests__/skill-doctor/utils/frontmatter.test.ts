import { parseFrontmatter } from '../../../src/skill-doctor/utils/frontmatter';

describe('parseFrontmatter', () => {
  it('parses well-formed frontmatter', () => {
    const src = `---\nname: foo\ndescription: a tool\n---\n\n# body`;
    const { data, body } = parseFrontmatter(src);
    expect(data).toEqual({ name: 'foo', description: 'a tool' });
    expect(body.trim()).toBe('# body');
  });

  it('returns empty data when no frontmatter', () => {
    const { data, body } = parseFrontmatter('# only body');
    expect(data).toEqual({});
    expect(body).toBe('# only body');
  });

  it('handles missing closing fence gracefully', () => {
    const { data } = parseFrontmatter('---\nname: foo\n# no fence');
    expect(data).toEqual({});
  });
});
