import path from 'path';
import { loadLocalAuth } from '../../src/codex-usage/auth';

describe('codex-usage/auth', () => {
  it('loads ChatGPT access token and account id from auth.json', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt-auth.json');

    const result = await loadLocalAuth(fixturePath);

    expect(result.accountId).toBe('workspace-123');
    expect(result.planType).toBe('pro');
    expect(result.accessToken).toBe('access-token');
  });

  it('rejects api key auth', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'api-key-auth.json');

    await expect(loadLocalAuth(fixturePath)).rejects.toThrow('ChatGPT login');
  });
});
