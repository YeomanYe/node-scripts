import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig } from '../../src/codex-usage/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('codex-usage loadPollConfig', () => {
  test('loads full config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 60
alert:
  windows: [primary, secondary]
channels:
  - type: feishu
    app_id: cli_x
    app_secret: s
    receive_id: oc_1
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(60);
    expect(cfg.alert.windows).toEqual(['primary', 'secondary']);
    expect(cfg.channels).toHaveLength(1);
  });

  test('default windows = [primary, secondary]', async () => {
    const file = await writeTemp(`channels: []\n`);
    const cfg = await loadPollConfig(file);
    expect(cfg.alert.windows).toEqual(['primary', 'secondary']);
  });

  test('rejects unknown window name', async () => {
    const file = await writeTemp(`
alert:
  windows: [tertiary]
channels: []
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/tertiary/);
  });
});
