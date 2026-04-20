import { FeishuNotifier, sendFeishuCard, _resetFeishuTokenCache } from '../../../src/shared/notifiers/feishu';
import type { FeishuChannelConfig } from '../../../src/shared/notifiers/types';

const config: FeishuChannelConfig = {
  type: 'feishu',
  app_id: 'cli_test',
  app_secret: 'secret',
  domain: 'https://open.feishu.cn',
  receive_id: 'oc_chat',
  receive_id_type: 'chat_id',
};

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body: unknown }>): FetchMock {
  const mock = jest.fn() as FetchMock;
  responses.forEach((r) => {
    mock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? 'OK' : 'ERR',
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as unknown as Response);
  });
  return mock;
}

describe('shared feishu notifier', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _resetFeishuTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sendFeishuCard caches tenant token across calls', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { code: 0, msg: 'ok', tenant_access_token: 'tkn', expire: 7200 } },
      { ok: true, body: { code: 0, msg: 'ok' } },
      { ok: true, body: { code: 0, msg: 'ok' } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendFeishuCard(config, 'Title 1', 'body 1');
    await sendFeishuCard(config, 'Title 2', 'body 2');

    // 1 token call + 2 message calls, token only fetched once
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = fetchMock.mock.calls[0]?.[0];
    expect(firstUrl).toContain('/open-apis/auth/v3/tenant_access_token/internal');
  });

  test('FeishuNotifier.send with level=warn uses red template', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { code: 0, msg: 'ok', tenant_access_token: 'tkn', expire: 7200 } },
      { ok: true, body: { code: 0, msg: 'ok' } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const notifier = new FeishuNotifier(config);
    await notifier.send({ title: 'T', content: 'c', level: 'warn' });

    const messageCall = fetchMock.mock.calls[1];
    const body = JSON.parse((messageCall?.[1]?.body as string) ?? '{}') as { content: string };
    const card = JSON.parse(body.content) as { header: { template: string } };
    expect(card.header.template).toBe('red');
  });

  test('level=info uses blue template', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { code: 0, msg: 'ok', tenant_access_token: 'tkn', expire: 7200 } },
      { ok: true, body: { code: 0, msg: 'ok' } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const notifier = new FeishuNotifier(config);
    await notifier.send({ title: 'T', content: 'c', level: 'info' });

    const body = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? '{}') as { content: string };
    const card = JSON.parse(body.content) as { header: { template: string } };
    expect(card.header.template).toBe('blue');
  });

  test('FeishuNotifier.send throws on API code != 0', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { code: 0, msg: 'ok', tenant_access_token: 'tkn', expire: 7200 } },
      { ok: true, body: { code: 9999, msg: 'nope' } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const notifier = new FeishuNotifier(config);
    await expect(
      notifier.send({ title: 'T', content: 'c', level: 'info' })
    ).rejects.toThrow(/nope/);
  });

  test('sendFeishuCard is a no-op when required fields missing', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // preserves existing task-runner behavior: empty config → skip silently
    await sendFeishuCard(
      { type: 'feishu', app_id: '', app_secret: '', receive_id: '' } as FeishuChannelConfig,
      'T',
      'c'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
