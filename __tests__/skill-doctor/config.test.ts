import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadFeishuConfig } from '../../src/skill-doctor/config';

describe('loadFeishuConfig', () => {
  let tmp: string;
  let cfgPath: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-cfg-'));
    cfgPath = path.join(tmp, 'feishu.json');
    await fs.writeFile(cfgPath, JSON.stringify({
      type: 'feishu',
      app_id: 'a',
      app_secret: 's',
      receive_id: 'r',
    }));
  });

  it('returns null when no path resolves', async () => {
    await expect(loadFeishuConfig(undefined, undefined, path.join(tmp, 'nope.json'))).resolves.toBeNull();
  });

  it('loads from explicit cliPath', async () => {
    const cfg = await loadFeishuConfig(cfgPath);
    expect(cfg?.app_id).toBe('a');
  });

  it('throws on schema mismatch', async () => {
    const bad = path.join(tmp, 'bad.json');
    await fs.writeFile(bad, JSON.stringify({ type: 'feishu', app_id: 1 }));
    await expect(loadFeishuConfig(bad)).rejects.toThrow();
  });
});
