import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig } from '../../src/minimax-usage/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mmx-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('minimax-usage loadPollConfig', () => {
  test('loads Claude-style channel config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 900
alert:
  windows: [five_hour]
channels:
  - type: feishu
    app_id: cli_x
    app_secret: s
    receive_id: oc_1
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(900);
    expect(cfg.channels).toHaveLength(1);
  });

  test('rejects unknown channel type', async () => {
    const file = await writeTemp(`
channels:
  - type: webhook
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/未知通道类型/);
  });
});
