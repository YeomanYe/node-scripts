import { parseStatusSpec, statusMatches, checkOnce } from '../../src/zai-watch/check';

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
});
