import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadBurnConfig } from '../../src/llm-tail-burn/config';

async function withConfig<T>(yaml: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-tail-burn-cfg-'));
  const file = path.join(dir, 'config.yaml');
  try {
    await fs.writeFile(file, yaml, 'utf-8');
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('loadBurnConfig', () => {
  it('provider.type 自动推断 agent kind，无需 kind 字段', async () => {
    const yaml = `
providers:
  mm: { type: minimax }
  codex: { type: codex }
  claude: { type: claude }
tasks:
  t1:
    match: any
    agents:
      - { provider: mm, leadTimeSeconds: 60, minRemainingPercent: 5 }
      - { provider: codex, ratePerHour: 3 }
      - { provider: claude, shortWindowConsumePercent: 8 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      const cfg = await loadBurnConfig(file);
      const task = cfg.tasks['t1']!;
      expect(task.agents).toHaveLength(3);
      const [a1, a2, a3] = task.agents;
      expect(a1?.kind).toBe('tail');
      expect(a2?.kind).toBe('rate');
      expect(a3?.kind).toBe('projection');
    });
  });

  it('复合 provider：claude/zai 不写 window 自动展开 short+long', async () => {
    const yaml = `
providers:
  claude: { type: claude }
  zai: { type: zai }
tasks:
  t1:
    agents:
      - { provider: claude }
      - { provider: zai }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      const cfg = await loadBurnConfig(file);
      // claude → claude (fiveHour) + claude#long (sevenDay)
      expect(cfg.providers['claude']!.window).toBe('fiveHour');
      expect(cfg.providers['claude#long']!.window).toBe('sevenDay');
      // zai → zai (primary) + zai#long (secondary)
      expect(cfg.providers['zai']!.window).toBe('primary');
      expect(cfg.providers['zai#long']!.window).toBe('secondary');

      const proj = cfg.tasks['t1']!.agents[0] as { kind: string; pairedProvider: string };
      expect(proj.kind).toBe('projection');
      expect(proj.pairedProvider).toBe('claude#long');
    });
  });

  it('单窗口 provider 模式：claude 写 window 仍可用，但 agent 必须显式 pairedProvider', async () => {
    const yaml = `
providers:
  claude-5h: { type: claude, window: fiveHour }
  claude-7d: { type: claude, window: sevenDay }
tasks:
  t1:
    agents:
      - { provider: claude-5h, pairedProvider: claude-7d, shortWindowConsumePercent: 8 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      const cfg = await loadBurnConfig(file);
      // 不应该自动展开 #long
      expect(cfg.providers['claude-5h#long']).toBeUndefined();
      const proj = cfg.tasks['t1']!.agents[0] as { pairedProvider: string };
      expect(proj.pairedProvider).toBe('claude-7d');
    });
  });

  it('显式 kind 字段 → 报错', async () => {
    const yaml = `
providers:
  mm: { type: minimax, window: interval }
tasks:
  t1:
    agents:
      - { provider: mm, kind: tail, leadTimeSeconds: 60, minRemainingPercent: 5 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      await expect(loadBurnConfig(file)).rejects.toThrow(/kind 不允许显式配置/);
    });
  });

  it('projection agent 必须能找到 pairedProvider（单窗口模式 + 不配 pairedProvider → 报错）', async () => {
    const yaml = `
providers:
  claude-5h: { type: claude, window: fiveHour }
tasks:
  t1:
    agents:
      - { provider: claude-5h, shortWindowConsumePercent: 8 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      await expect(loadBurnConfig(file)).rejects.toThrow(/pairedProvider 未注册/);
    });
  });

  it('projection agent 的 pairedProvider 类型必须一致', async () => {
    const yaml = `
providers:
  claude: { type: claude }
  codex: { type: codex }
tasks:
  t1:
    agents:
      - { provider: claude, pairedProvider: codex, shortWindowConsumePercent: 8 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      await expect(loadBurnConfig(file)).rejects.toThrow(/类型.*必须.*一致/);
    });
  });

  it('match 默认 any', async () => {
    const yaml = `
providers:
  mm: { type: minimax }
tasks:
  t1:
    agents:
      - { provider: mm, leadTimeSeconds: 60, minRemainingPercent: 5 }
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      const cfg = await loadBurnConfig(file);
      expect(cfg.tasks['t1']!.match).toBe('any');
    });
  });

  it('agents 必须非空', async () => {
    const yaml = `
providers:
  mm: { type: minimax }
tasks:
  t1:
    agents: []
    cmd: echo ok
`;
    await withConfig(yaml, async (file) => {
      await expect(loadBurnConfig(file)).rejects.toThrow(/agents 必须是非空数组/);
    });
  });
});
