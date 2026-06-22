import { resolveConfig } from '../../src/zai-watch/index';

describe('resolveConfig (CLI > file > defaults)', () => {
  it('uses defaults when nothing set', () => {
    const cfg = resolveConfig({}, {});
    expect(cfg.url).toBe('https://z.ai');
    expect(cfg.intervalSec).toBe(60);
    expect(cfg.timeoutSec).toBe(10);
    expect(cfg.successStatus).toBe('200-399');
    expect(cfg.consecutive).toBe(2);
    expect(cfg.project).toBe('default');
    expect(cfg.label).toBeUndefined();
    expect(cfg.maxChecks).toBeUndefined();
  });

  it('file config overrides defaults', () => {
    const cfg = resolveConfig({}, { url: 'https://example.com', consecutive: 3, intervalSec: 30 });
    expect(cfg.url).toBe('https://example.com');
    expect(cfg.consecutive).toBe(3);
    expect(cfg.intervalSec).toBe(30);
    expect(cfg.timeoutSec).toBe(10); // 仍走默认
  });

  it('CLI flags override file config', () => {
    const cfg = resolveConfig(
      { url: 'https://cli.example', interval: '5', consecutive: '1' },
      { url: 'https://file.example', intervalSec: 99, consecutive: 9 },
    );
    expect(cfg.url).toBe('https://cli.example');
    expect(cfg.intervalSec).toBe(5);
    expect(cfg.consecutive).toBe(1);
  });

  it('clamps consecutive to >= 1', () => {
    const cfg = resolveConfig({ consecutive: '0' }, {});
    expect(cfg.consecutive).toBe(1);
  });

  it('parses maxChecks and label', () => {
    const cfg = resolveConfig({ maxChecks: '3', label: 'z.ai 主站' }, {});
    expect(cfg.maxChecks).toBe(3);
    expect(cfg.label).toBe('z.ai 主站');
  });
});
