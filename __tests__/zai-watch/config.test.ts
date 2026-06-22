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

  it('defaults method to GET', () => {
    expect(resolveConfig({}, {}).method).toBe('GET');
  });

  it('carries method/headers/body and interpolates ${ENV} from injected env', () => {
    const cfg = resolveConfig(
      {},
      {
        method: 'POST',
        headers: { 'x-api-key': '${Z_API_KEY}', 'anthropic-version': '2023-06-01' },
        body: '{"model":"glm-4.6"}',
      },
      { Z_API_KEY: 'sk-real-token' } as NodeJS.ProcessEnv,
    );
    expect(cfg.method).toBe('POST');
    expect(cfg.headers).toEqual({
      'x-api-key': 'sk-real-token',
      'anthropic-version': '2023-06-01',
    });
    expect(cfg.body).toBe('{"model":"glm-4.6"}');
  });

  it('interpolates ${ENV} inside url too', () => {
    const cfg = resolveConfig(
      {},
      { url: 'https://${HOST}/v1' },
      { HOST: 'api.z.ai' } as NodeJS.ProcessEnv,
    );
    expect(cfg.url).toBe('https://api.z.ai/v1');
  });

  it('object body gets JSON.stringified and default content-type applied', () => {
    // normalizeRaw is not exported; emulate its output (_bodyWasObject + stringified body).
    const cfg = resolveConfig(
      {},
      {
        method: 'POST',
        headers: { 'x-api-key': 'k' },
        body: '{"a":1}',
        _bodyWasObject: true,
      },
      {} as NodeJS.ProcessEnv,
    );
    expect(cfg.headers).toEqual({ 'x-api-key': 'k', 'content-type': 'application/json' });
    expect(cfg.body).toBe('{"a":1}');
  });

  it('does not override an explicit content-type for object body', () => {
    const cfg = resolveConfig(
      {},
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"a":1}',
        _bodyWasObject: true,
      },
      {} as NodeJS.ProcessEnv,
    );
    expect(cfg.headers).toEqual({ 'Content-Type': 'application/json; charset=utf-8' });
  });
});
