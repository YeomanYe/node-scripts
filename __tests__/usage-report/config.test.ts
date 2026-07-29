import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadPollConfig } from '@/usage-report/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-report-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

describe('loadPollConfig', () => {
  it('parses only polling and notification settings', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 900
channels:
  - type: feishu
    app_id: "cli_x"
    app_secret: "secret"
    receive_id: "oc_x"
    receive_id_type: chat_id
`);

    const config = await loadPollConfig(file);
    expect(config.poll.interval_seconds).toBe(900);
    expect(config.channels).toHaveLength(1);
    expect(config.channels[0]).toMatchObject({
      type: 'feishu',
      app_id: 'cli_x',
      receive_id: 'oc_x',
    });
    expect(config).not.toHaveProperty('providers');
  });

  it('ignores legacy provider overrides because CodexBar owns provider and metric selection', async () => {
    const file = await writeTemp(`
channels: []
providers:
  claude:
    windows: [not-a-real-window]
  zai:
    api_host: https://example.com
`);

    await expect(loadPollConfig(file)).resolves.toEqual({
      poll: { interval_seconds: 300 },
      channels: [],
    });
  });

  it('defaults the poll interval to 300 seconds', async () => {
    const file = await writeTemp('channels: []\n');
    const config = await loadPollConfig(file);
    expect(config.poll.interval_seconds).toBe(300);
  });

  it('rejects a channel missing app_id', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_secret: s
    receive_id: r
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/app_id/);
  });

  it('rejects an unknown channel type', async () => {
    const file = await writeTemp(`
channels:
  - type: slack
    app_id: a
    app_secret: s
    receive_id: r
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/未知通道类型/);
  });
});
