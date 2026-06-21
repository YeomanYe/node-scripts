import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig, DEFAULT_CONFIG_PATH } from '@/zai-usage/config';

async function writeTmp(content: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `zai-cfg-${Date.now()}.yaml`);
  await fs.writeFile(tmp, content);
  return tmp;
}

describe('zai-usage config', () => {
  test('default config path', () => {
    expect(DEFAULT_CONFIG_PATH.endsWith('local/zai-usage-config.yaml')).toBe(true);
  });

  test('loads full config', async () => {
    const tmp = await writeTmp(`
poll:
  interval_seconds: 600
alert:
  windows: [primary]
channels:
  - type: feishu
    app_id: "a"
    app_secret: "s"
    receive_id: "r"
    receive_id_type: chat_id
`);
    const cfg = await loadPollConfig(tmp);
    expect(cfg.poll.interval_seconds).toBe(600);
    expect(cfg.alert.windows).toEqual(['primary']);
    expect(cfg.channels[0]?.type).toBe('feishu');
  });

  test('defaults — interval 300, windows [primary, secondary], channels []', async () => {
    const tmp = await writeTmp(`channels: []`);
    const cfg = await loadPollConfig(tmp);
    expect(cfg.poll.interval_seconds).toBe(300);
    expect(cfg.alert.windows).toEqual(['primary', 'secondary']);
  });

  test('throws on unknown channel type', async () => {
    const tmp = await writeTmp(`channels:\n  - type: slack\n`);
    await expect(loadPollConfig(tmp)).rejects.toThrow(/未知通道类型/);
  });

  test('throws on missing file', async () => {
    await expect(loadPollConfig('/nonexistent/zai.yaml')).rejects.toThrow(/配置文件不存在/);
  });

  test('throws on invalid alert window', async () => {
    const tmp = await writeTmp(`alert:\n  windows: [bogus]\n`);
    await expect(loadPollConfig(tmp)).rejects.toThrow(/alert.windows/);
  });
});
