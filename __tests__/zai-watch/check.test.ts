import { parseStatusSpec, statusMatches, checkOnce, interpolateEnv } from '../../src/zai-watch/check';

describe('parseStatusSpec / statusMatches', () => {
  it('matches a single status', () => {
    const m = parseStatusSpec('200');
    expect(m(200)).toBe(true);
    expect(m(201)).toBe(false);
    expect(m(199)).toBe(false);
  });

  it('matches an inclusive range with boundaries', () => {
    const m = parseStatusSpec('200-399');
    expect(m(200)).toBe(true); // 下界
    expect(m(399)).toBe(true); // 上界
    expect(m(300)).toBe(true);
    expect(m(199)).toBe(false);
    expect(m(400)).toBe(false);
  });

  it('matches a comma list mixing single and range', () => {
    const m = parseStatusSpec('200,301-399');
    expect(m(200)).toBe(true);
    expect(m(301)).toBe(true);
    expect(m(399)).toBe(true);
    expect(m(250)).toBe(false); // 不在任何片段
    expect(m(300)).toBe(false); // 落在 200 和 301 之间的空档
  });

  it('tolerates surrounding whitespace', () => {
    const m = parseStatusSpec(' 200 , 301 - 399 ');
    expect(m(200)).toBe(true);
    expect(m(350)).toBe(true);
  });

  it('throws on empty / illegal / inverted spec', () => {
    expect(() => parseStatusSpec('')).toThrow();
    expect(() => parseStatusSpec('abc')).toThrow();
    expect(() => parseStatusSpec('399-200')).toThrow();
  });

  it('statusMatches convenience wrapper', () => {
    expect(statusMatches(204, '200-399')).toBe(true);
    expect(statusMatches(404, '200-399')).toBe(false);
  });
});

describe('checkOnce (injected fetch)', () => {
  const mkFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) =>
    impl as unknown as typeof fetch;

  const mkResponse = (status: number, body = ''): Response =>
    ({ status, text: async () => body } as unknown as Response);

  it('ok path: status in range, no body checks', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(200));
    const r = await checkOnce('https://z.ai', { timeoutMs: 1000, successStatus: '200-399', fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(typeof r.timeMs).toBe('number');
  });

  it('follows redirects (passes redirect: follow)', async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = mkFetch(async (_url, init) => {
      seenInit = init;
      return mkResponse(301); // 模拟最终落点(实际 follow 由 fetch 处理)
    });
    await checkOnce('https://z.ai', { timeoutMs: 1000, successStatus: '200-399', fetchImpl });
    expect(seenInit?.redirect).toBe('follow');
  });

  it('wrong-status: final status outside spec → ok false', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(503));
    const r = await checkOnce('https://z.ai', { timeoutMs: 1000, successStatus: '200-399', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.error).toMatch(/503/);
  });

  it('network-error → ok false, status null, error set', async () => {
    const fetchImpl = mkFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await checkOnce('https://z.ai', { timeoutMs: 1000, successStatus: '200-399', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('timeout/abort → ok false, status null, 超时 error', async () => {
    const fetchImpl = mkFetch(async () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    });
    const r = await checkOnce('https://z.ai', { timeoutMs: 5, successStatus: '200-399', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/超时/);
  });

  it('mustInclude satisfied → ok true', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(200, '<html>Welcome to Z.ai</html>'));
    const r = await checkOnce('https://z.ai', {
      timeoutMs: 1000,
      successStatus: '200-399',
      mustInclude: 'Welcome',
      fetchImpl,
    });
    expect(r.ok).toBe(true);
  });

  it('mustInclude missing → ok false', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(200, 'nope'));
    const r = await checkOnce('https://z.ai', {
      timeoutMs: 1000,
      successStatus: '200-399',
      mustInclude: 'Welcome',
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mustInclude/);
  });

  it('mustNotInclude present (block page marker) → ok false', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(200, 'Access Denied: you are blocked'));
    const r = await checkOnce('https://z.ai', {
      timeoutMs: 1000,
      successStatus: '200-399',
      mustNotInclude: 'Access Denied',
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mustNotInclude/);
  });

  it('mustNotInclude absent → ok true', async () => {
    const fetchImpl = mkFetch(async () => mkResponse(200, 'all good'));
    const r = await checkOnce('https://z.ai', {
      timeoutMs: 1000,
      successStatus: '200-399',
      mustNotInclude: 'Access Denied',
      fetchImpl,
    });
    expect(r.ok).toBe(true);
  });

  it('passes method / headers / body to fetch', async () => {
    let seenUrl: string | undefined;
    let seenInit: RequestInit | undefined;
    const fetchImpl = mkFetch(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return mkResponse(200);
    });
    const r = await checkOnce('https://api.z.ai/api/anthropic/v1/messages', {
      timeoutMs: 1000,
      successStatus: '200',
      method: 'POST',
      headers: { 'x-api-key': 'sk-real-token', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: '{"model":"glm-4.6","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}',
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(seenUrl).toBe('https://api.z.ai/api/anthropic/v1/messages');
    expect(seenInit?.method).toBe('POST');
    expect(seenInit?.redirect).toBe('follow');
    expect(seenInit?.headers).toEqual({
      'x-api-key': 'sk-real-token',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(seenInit?.body).toBe(
      '{"model":"glm-4.6","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}',
    );
  });

  it('defaults to GET when method omitted, no body sent', async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = mkFetch(async (_url, init) => {
      seenInit = init;
      return mkResponse(200);
    });
    await checkOnce('https://z.ai', { timeoutMs: 1000, successStatus: '200-399', fetchImpl });
    expect(seenInit?.method).toBe('GET');
    expect(seenInit?.body).toBeUndefined();
  });

  it('successStatus "200" matches only 200; 429 → ok false', async () => {
    const ok = mkFetch(async () => mkResponse(200));
    const rateLimited = mkFetch(async () => mkResponse(429));
    const r200 = await checkOnce('https://api.z.ai', { timeoutMs: 1000, successStatus: '200', fetchImpl: ok });
    expect(r200.ok).toBe(true);
    expect(r200.status).toBe(200);
    const r429 = await checkOnce('https://api.z.ai', { timeoutMs: 1000, successStatus: '200', fetchImpl: rateLimited });
    expect(r429.ok).toBe(false);
    expect(r429.status).toBe(429);
    expect(r429.error).toMatch(/429/);
  });
});

describe('interpolateEnv', () => {
  it('replaces a single ${VAR} from env', () => {
    expect(interpolateEnv('${TOKEN}', { TOKEN: 'sk-abc' })).toBe('sk-abc');
    expect(interpolateEnv('Bearer ${TOKEN}', { TOKEN: 'sk-abc' })).toBe('Bearer sk-abc');
  });

  it('replaces multiple distinct vars', () => {
    expect(interpolateEnv('${A}-${B}-${A}', { A: 'x', B: 'y' })).toBe('x-y-x');
  });

  it('unset var → empty string', () => {
    expect(interpolateEnv('[${MISSING}]', {})).toBe('[]');
  });

  it('no-op when there is no ${}', () => {
    expect(interpolateEnv('plain string', { FOO: 'bar' })).toBe('plain string');
  });

  it('defaults env to process.env', () => {
    process.env.__ZAI_WATCH_TEST__ = 'from-process';
    expect(interpolateEnv('${__ZAI_WATCH_TEST__}')).toBe('from-process');
    delete process.env.__ZAI_WATCH_TEST__;
  });
});
