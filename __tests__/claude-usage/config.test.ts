import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig } from '../../src/claude-usage/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cu-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('claude-usage loadPollConfig', () => {
  test('loads full config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 120
alert:
  windows: [five_hour, seven_day]
channels:
  - type: feishu
    app_id: cli_x
    app_secret: s
    receive_id: oc_1
    receive_id_type: chat_id
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(120);
    expect(cfg.alert.windows).toEqual(['five_hour', 'seven_day']);
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]).toMatchObject({ type: 'feishu', app_id: 'cli_x' });
  });

  test('fills defaults for missing sections', async () => {
    const file = await writeTemp(`
channels: []
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(300);
    expect(cfg.alert.windows).toEqual(['five_hour', 'seven_day']);
    expect(cfg.channels).toEqual([]);
  });

  test('rejects unknown window name', async () => {
    const file = await writeTemp(`
alert:
  windows: [bogus_window]
channels: []
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/bogus_window/);
  });

  test('rejects unknown channel type', async () => {
    const file = await writeTemp(`
channels:
  - type: slack
    webhook: https://example.com
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/slack|未知通道/);
  });

  test('rejects missing file with clear error', async () => {
    await expect(loadPollConfig('/tmp/does-not-exist-xyz.yaml')).rejects.toThrow(/不存在|ENOENT/);
  });
});
