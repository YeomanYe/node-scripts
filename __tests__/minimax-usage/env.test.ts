import { parseDotEnv, expandHome } from '../../src/minimax-usage/env';

describe('minimax-usage env', () => {
  test('parses dotenv values without exposing comments', () => {
    expect(parseDotEnv(`
# comment
MINIMAX_API_KEY="sk-test"
export OTHER='value'
BAD LINE
`)).toEqual({
      MINIMAX_API_KEY: 'sk-test',
      OTHER: 'value',
    });
  });

  test('expands home path', () => {
    expect(expandHome('~/Documents/knowledge/local/.env')).toContain('/Documents/knowledge/local/.env');
  });
});
