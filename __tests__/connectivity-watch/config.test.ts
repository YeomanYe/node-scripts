import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_TARGETS, loadConfig } from '../../src/connectivity-watch/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connectivity-watch-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('connectivity-watch config', () => {
  it('loads Feishu channel from codex-style local config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 900
channels:
  - type: feishu
    app_id: app_x
    app_secret: secret_x
    domain: https://open.feishu.cn
    receive_id: oc_x
    receive_id_type: chat_id
`);

    const cfg = await loadConfig(file);

    expect(cfg.intervalSeconds).toBe(60);
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]).toMatchObject({
      type: 'feishu',
      app_id: 'app_x',
      app_secret: 'secret_x',
      receive_id: 'oc_x',
    });
    expect(cfg.targets.map((t) => t.key)).toEqual(DEFAULT_TARGETS.map((t) => t.key));
  });

  it('allows connectivity_watch to override interval, timeout, state file, and targets', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: app_x
    app_secret: secret_x
    receive_id: oc_x
connectivity_watch:
  interval_seconds: 15
  timeout_seconds: 3
  state_file: local/custom-state.json
  targets:
    - key: example
      label: Example
      url: https://example.com/health
      success_status: 200,204
`);

    const cfg = await loadConfig(file);

    expect(cfg.intervalSeconds).toBe(15);
    expect(cfg.timeoutMs).toBe(3000);
    expect(cfg.stateFile).toBe(path.resolve('local/custom-state.json'));
    expect(cfg.targets).toEqual([
      {
        key: 'example',
        label: 'Example',
        url: 'https://example.com/health',
        method: 'GET',
        successStatus: '200,204',
      },
    ]);
  });
});
