import { parseDotEnv, readZaiApiKey, DEFAULT_API_KEY_ENV } from '@/zai-usage/env';

describe('zai-usage env', () => {
  // 测试隔离：确保进程环境中的 Z_API_KEY 不会污染“缺失即抛错”用例
  const previousKey = process.env.Z_API_KEY;
  beforeEach(() => {
    delete process.env.Z_API_KEY;
  });
  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.Z_API_KEY;
    } else {
      process.env.Z_API_KEY = previousKey;
    }
  });

  test('default api key env name is Z_API_KEY', () => {
    expect(DEFAULT_API_KEY_ENV).toBe('Z_API_KEY');
  });

  test('parseDotEnv parses and unquotes', () => {
    const map = parseDotEnv('Z_API_KEY="abc"\nexport OTHER=1\n# comment\n');
    expect(map.Z_API_KEY).toBe('abc');
    expect(map.OTHER).toBe('1');
  });

  test('readZaiApiKey prefers file values then process.env', async () => {
    const tmp = require('path').join(require('os').tmpdir(), `zai-env-${Date.now()}.env`);
    require('fs').writeFileSync(tmp, 'Z_API_KEY=fromfile\n');
    expect(await readZaiApiKey({ envFile: tmp, apiKeyEnv: 'Z_API_KEY' })).toBe('fromfile');
  });

  test('readZaiApiKey throws when missing', async () => {
    await expect(readZaiApiKey({ envFile: '/nonexistent/.env', apiKeyEnv: 'Z_API_KEY' }))
      .rejects.toThrow(/未找到 Z_API_KEY/);
  });
});
