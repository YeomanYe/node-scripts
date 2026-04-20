# Usage Poll + Notify + PM2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add headless interval polling to `claude-usage` / `codex-usage`, route each tick through a pluggable notifier (Feishu first) with "linear-prorated" breach alerts, and ship a PM2 ecosystem config under `local/` for auto-start.

**Architecture:** A new `src/shared/` package provides pure-function alert (`prorated.ts`) and notifier abstractions (`notifiers/types.ts`, `notifiers/feishu.ts`, `notifiers/index.ts`). Each usage tool gets a `config.ts` (YAML loader with default-merge) and a `poll.ts` (headless loop, per-window alert check, fan-out to notifiers, PM2-safe error tolerance). The CLI entrypoints grow `--poll <sec>` and `--config <path>` flags. `src/claude-task-runner/feishu.ts` becomes a thin re-export so existing call sites in both task runners keep working.

**Tech Stack:** TypeScript (strict, CommonJS target ES2022), `commander` for CLI, `yaml` for config, Jest + ts-jest, `fetch` for HTTP, PM2 for supervisor.

---

## File Structure

**Create**
- `src/shared/alert/prorated.ts` — pure fn `checkProrated`
- `src/shared/notifiers/types.ts` — `Notifier`, `NotifierMessage`, `ChannelConfig`
- `src/shared/notifiers/feishu.ts` — `sendFeishuCard` + `FeishuNotifier`
- `src/shared/notifiers/index.ts` — `buildNotifiers`
- `src/claude-usage/config.ts` — YAML loader for usage poll
- `src/claude-usage/poll.ts` — headless loop
- `src/codex-usage/config.ts` — YAML loader
- `src/codex-usage/poll.ts` — headless loop
- `local/claude-usage-config.yaml` — sample
- `local/codex-usage-config.yaml` — sample
- `local/pm2.config.js` — ecosystem file
- `__tests__/shared/alert/prorated.test.ts`
- `__tests__/shared/notifiers/feishu.test.ts`
- `__tests__/claude-usage/config.test.ts`
- `__tests__/claude-usage/poll.test.ts`
- `__tests__/codex-usage/config.test.ts`
- `__tests__/codex-usage/poll.test.ts`

**Modify**
- `src/claude-task-runner/feishu.ts` → thin re-export
- `src/claude-usage/index.ts` → add `--poll`, `--config`
- `src/codex-usage/index.ts` → add `--poll`, `--config`
- `docs/claude-usage.md` → 新增"轮询 + 通知 + PM2"章节
- `docs/codex-usage.md` → 同上

---

## Task 1: Linear-prorated alert function (pure)

**Files:**
- Create: `src/shared/alert/prorated.ts`
- Test: `__tests__/shared/alert/prorated.test.ts`

- [ ] **Step 1.1: Write failing test**

Create `__tests__/shared/alert/prorated.test.ts`:

```ts
import { checkProrated } from '../../../src/shared/alert/prorated';

const DAY = 24 * 60 * 60 * 1000;

describe('checkProrated', () => {
  test('at window start: expected ≈ 0', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 0,
      resetsAtMs: now + 7 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(0, 5);
    expect(result.breached).toBe(false);
    expect(result.overBy).toBeCloseTo(0, 5);
  });

  test('half-way through window: expected ≈ 50', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 40,
      resetsAtMs: now + 3.5 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(50, 5);
    expect(result.breached).toBe(false);
    expect(result.overBy).toBeCloseTo(-10, 5);
  });

  test('breach: utilization > expected', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 60,
      resetsAtMs: now + 3.5 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(50, 5);
    expect(result.breached).toBe(true);
    expect(result.overBy).toBeCloseTo(10, 5);
  });

  test('user example: day 1 of 7, 15% used, expected ≈ 14.28 → breached', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 15,
      resetsAtMs: now + 6 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(100 / 7, 2);
    expect(result.breached).toBe(true);
  });

  test('near reset: expected ≈ 100', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 99,
      resetsAtMs: now + 60_000,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeGreaterThan(99.9);
    expect(result.breached).toBe(false);
  });

  test('windowMs <= 0 throws', () => {
    expect(() =>
      checkProrated({ utilization: 0, resetsAtMs: 0, windowMs: 0, nowMs: 0 })
    ).toThrow(/windowMs/);
  });

  test('clamps expected to [0, 100]', () => {
    const now = 1_700_000_000_000;
    // Reset already passed → elapsed > windowMs → clamp to 100
    const past = checkProrated({
      utilization: 50,
      resetsAtMs: now - 60_000,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(past.expected).toBe(100);
    // Reset far in future (bad data) → negative elapsed → clamp to 0
    const future = checkProrated({
      utilization: 50,
      resetsAtMs: now + 30 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(future.expected).toBe(0);
  });
});
```

- [ ] **Step 1.2: Run test to verify failure**

Run: `pnpm test -- __tests__/shared/alert/prorated.test.ts`
Expected: FAIL — module `src/shared/alert/prorated` not found.

- [ ] **Step 1.3: Implement `prorated.ts`**

Create `src/shared/alert/prorated.ts`:

```ts
/** 单次线性预算检查输入 */
export interface ProratedInput {
  /** 当前用量百分比（0-100） */
  utilization: number;
  /** 窗口重置的绝对毫秒时间戳 */
  resetsAtMs: number;
  /** 窗口总长度（毫秒） */
  windowMs: number;
  /** 当前毫秒时间戳（便于测试注入），默认 Date.now() */
  nowMs?: number;
}

/** 单次线性预算检查结果 */
export interface ProratedResult {
  /** 当前时点的"线性预算"百分比 = elapsed / windowMs × 100，已截断到 [0, 100] */
  expected: number;
  /** 是否超出线性预算 */
  breached: boolean;
  /** utilization - expected（百分点） */
  overBy: number;
}

/**
 * 线性预算告警判定：当前用量是否超过"已过去时间占窗口比例"
 * @throws 当 windowMs <= 0 时
 */
export function checkProrated(input: ProratedInput): ProratedResult {
  if (!Number.isFinite(input.windowMs) || input.windowMs <= 0) {
    throw new Error(`checkProrated: windowMs must be > 0, got ${input.windowMs}`);
  }

  const now = input.nowMs ?? Date.now();
  const elapsed = input.windowMs - (input.resetsAtMs - now);
  const rawExpected = (elapsed / input.windowMs) * 100;
  const expected = Math.min(100, Math.max(0, rawExpected));
  const overBy = input.utilization - expected;

  return {
    expected,
    breached: overBy > 0,
    overBy,
  };
}
```

- [ ] **Step 1.4: Run test to verify pass**

Run: `pnpm test -- __tests__/shared/alert/prorated.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 1.5: Commit**

```bash
git add src/shared/alert/prorated.ts __tests__/shared/alert/prorated.test.ts
git commit -m "feat: add linear-prorated alert helper"
```

---

## Task 2: Shared notifier types

**Files:**
- Create: `src/shared/notifiers/types.ts`

Pure type file, no runtime behavior — no test needed in isolation (covered by Task 3).

- [ ] **Step 2.1: Create `types.ts`**

Create `src/shared/notifiers/types.ts`:

```ts
/** 通知消息 */
export interface NotifierMessage {
  /** 标题（飞书卡片 header） */
  title: string;
  /** lark_md 格式正文 */
  content: string;
  /** 级别：warn 时使用红色 header，info 使用蓝色 */
  level: 'info' | 'warn';
}

/** 通知器接口 */
export interface Notifier {
  /** 通知器名（用于日志） */
  readonly name: string;
  /** 发送消息；失败时抛出错误 */
  send(msg: NotifierMessage): Promise<void>;
}

/** 飞书通道配置（已有 claude-task-runner 使用） */
export interface FeishuChannelConfig {
  type: 'feishu';
  app_id: string;
  app_secret: string;
  domain?: string;
  receive_id: string;
  receive_id_type?: 'chat_id' | 'open_id' | 'user_id' | 'email';
}

/** 通道配置联合类型（后续可扩展） */
export type ChannelConfig = FeishuChannelConfig;
```

- [ ] **Step 2.2: Verify compile**

Run: `pnpm run build`
Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/shared/notifiers/types.ts
git commit -m "feat: add shared notifier types"
```

---

## Task 3: Extract Feishu into shared + re-export from task-runner

**Files:**
- Create: `src/shared/notifiers/feishu.ts`
- Create: `src/shared/notifiers/index.ts`
- Modify: `src/claude-task-runner/feishu.ts` (full rewrite → re-export)
- Test: `__tests__/shared/notifiers/feishu.test.ts`

- [ ] **Step 3.1: Write failing test for shared feishu**

Create `__tests__/shared/notifiers/feishu.test.ts`:

```ts
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
```

- [ ] **Step 3.2: Run test to verify failure**

Run: `pnpm test -- __tests__/shared/notifiers/feishu.test.ts`
Expected: FAIL — module `src/shared/notifiers/feishu` not found.

- [ ] **Step 3.3: Implement shared feishu**

Create `src/shared/notifiers/feishu.ts`:

```ts
import { FeishuChannelConfig, Notifier, NotifierMessage } from './types';

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** key = `${app_id}|${domain}` */
const tokenCache = new Map<string, CachedToken>();

/** 仅用于测试 */
export function _resetFeishuTokenCache(): void {
  tokenCache.clear();
}

function resolveDomain(config: FeishuChannelConfig): string {
  return config.domain ?? 'https://open.feishu.cn';
}

function resolveReceiveIdType(config: FeishuChannelConfig): string {
  return config.receive_id_type ?? 'chat_id';
}

async function getTenantToken(config: FeishuChannelConfig): Promise<string> {
  const domain = resolveDomain(config);
  const key = `${config.app_id}|${domain}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: config.app_id, app_secret: config.app_secret }),
  });

  if (!response.ok) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as TenantTokenResponse;
  if (data.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${data.msg}`);
  }

  tokenCache.set(key, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + data.expire * 1000,
  });

  return data.tenant_access_token;
}

function buildCardMessage(title: string, content: string, level: 'info' | 'warn'): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: level === 'warn' ? 'red' : 'blue',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
  });
}

/**
 * 发送飞书交互卡片（保持与旧 claude-task-runner 签名兼容）。
 * 若 app_id / app_secret / receive_id 任一为空则静默跳过。
 */
export async function sendFeishuCard(
  config: FeishuChannelConfig,
  title: string,
  content: string,
  level: 'info' | 'warn' = 'info'
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id) {
    return;
  }

  const token = await getTenantToken(config);
  const domain = resolveDomain(config);
  const url = `${domain}/open-apis/im/v1/messages?receive_id_type=${resolveReceiveIdType(config)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: config.receive_id,
      msg_type: 'interactive',
      content: buildCardMessage(title, content, level),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`飞书消息发送失败 HTTP ${response.status}: ${text}`);
  }

  const result = (await response.json()) as { code?: number; msg?: string };
  if (result.code !== 0) {
    throw new Error(`飞书消息发送失败: ${result.msg ?? '未知错误'}`);
  }
}

/** Notifier 接口实现：把 FeishuChannelConfig 包装成 Notifier */
export class FeishuNotifier implements Notifier {
  readonly name = 'feishu';
  constructor(private readonly config: FeishuChannelConfig) {}

  async send(msg: NotifierMessage): Promise<void> {
    await sendFeishuCard(this.config, msg.title, msg.content, msg.level);
  }
}
```

- [ ] **Step 3.4: Create `shared/notifiers/index.ts`**

Create `src/shared/notifiers/index.ts`:

```ts
import { ChannelConfig, Notifier } from './types';
import { FeishuNotifier } from './feishu';

/** 根据配置构造 Notifier 数组；未知 type 抛错 */
export function buildNotifiers(channels: ChannelConfig[]): Notifier[] {
  return channels.map((channel) => {
    switch (channel.type) {
      case 'feishu':
        return new FeishuNotifier(channel);
      default: {
        const exhaustive: never = channel;
        throw new Error(`未知通道类型: ${JSON.stringify(exhaustive)}`);
      }
    }
  });
}

export type { ChannelConfig, Notifier, NotifierMessage, FeishuChannelConfig } from './types';
export { FeishuNotifier, sendFeishuCard } from './feishu';
```

- [ ] **Step 3.5: Rewrite `src/claude-task-runner/feishu.ts` as re-export**

Replace full contents of `src/claude-task-runner/feishu.ts` with:

```ts
import { FeishuConfig } from './types';
import { log, logError } from './log';
import { sendFeishuCard as sharedSend } from '../shared/notifiers/feishu';

/**
 * 发送飞书交互卡片（保持旧接口：config/title/content）。
 * 与 shared 实现的差异：保留旧的 log / logError 行为。
 */
export async function sendFeishuCard(
  config: FeishuConfig,
  title: string,
  content: string
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id) {
    log('飞书未配置，跳过通知发送');
    return;
  }

  try {
    await sharedSend(
      {
        type: 'feishu',
        app_id: config.app_id,
        app_secret: config.app_secret,
        domain: config.domain,
        receive_id: config.receive_id,
        receive_id_type: config.receive_id_type as 'chat_id' | 'open_id' | 'user_id' | 'email',
      },
      title,
      content,
      'info'
    );
    log(`飞书通知已发送: ${title}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    logError(`飞书通知发送失败: ${message}`);
  }
}
```

- [ ] **Step 3.6: Run tests**

Run: `pnpm test`
Expected: all existing tests + new feishu tests PASS.

- [ ] **Step 3.7: Commit**

```bash
git add src/shared/notifiers/ src/claude-task-runner/feishu.ts __tests__/shared/notifiers/
git commit -m "refactor: extract feishu into shared notifiers package"
```

---

## Task 4: claude-usage config loader

**Files:**
- Create: `src/claude-usage/config.ts`
- Test: `__tests__/claude-usage/config.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `__tests__/claude-usage/config.test.ts`:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig } from '../../src/claude-usage/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cu-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('claude-usage loadPollConfig', () => {
  test('loads full config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 120
alert:
  windows: [five_hour, seven_day]
channels:
  - type: feishu
    app_id: cli_x
    app_secret: s
    receive_id: oc_1
    receive_id_type: chat_id
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(120);
    expect(cfg.alert.windows).toEqual(['five_hour', 'seven_day']);
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]).toMatchObject({ type: 'feishu', app_id: 'cli_x' });
  });

  test('fills defaults for missing sections', async () => {
    const file = await writeTemp(`
channels: []
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(300);
    expect(cfg.alert.windows).toEqual(['five_hour', 'seven_day']);
    expect(cfg.channels).toEqual([]);
  });

  test('rejects unknown window name', async () => {
    const file = await writeTemp(`
alert:
  windows: [bogus_window]
channels: []
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/bogus_window/);
  });

  test('rejects unknown channel type', async () => {
    const file = await writeTemp(`
channels:
  - type: slack
    webhook: https://example.com
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/slack|未知通道/);
  });

  test('rejects missing file with clear error', async () => {
    await expect(loadPollConfig('/tmp/does-not-exist-xyz.yaml')).rejects.toThrow(/不存在|ENOENT/);
  });
});
```

- [ ] **Step 4.2: Run test to verify failure**

Run: `pnpm test -- __tests__/claude-usage/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `config.ts`**

Create `src/claude-usage/config.ts`:

```ts
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ChannelConfig } from '../shared/notifiers/types';

/** Claude 用量轮询支持告警的窗口 */
export type ClaudeAlertWindow =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_sonnet'
  | 'seven_day_opus';

const VALID_WINDOWS: readonly ClaudeAlertWindow[] = [
  'five_hour',
  'seven_day',
  'seven_day_sonnet',
  'seven_day_opus',
];

export interface PollConfig {
  poll: { interval_seconds: number };
  alert: { windows: ClaudeAlertWindow[] };
  channels: ChannelConfig[];
}

const DEFAULTS: PollConfig = {
  poll: { interval_seconds: 300 },
  alert: { windows: ['five_hour', 'seven_day'] },
  channels: [],
};

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`channels[${index}] 不是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') {
    throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
  }
  const required = ['app_id', 'app_secret', 'receive_id'] as const;
  for (const key of required) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
      throw new Error(`channels[${index}].${key} 缺失或为空`);
    }
  }
  return {
    type: 'feishu',
    app_id: obj['app_id'] as string,
    app_secret: obj['app_secret'] as string,
    receive_id: obj['receive_id'] as string,
    ...(typeof obj['domain'] === 'string' ? { domain: obj['domain'] } : {}),
    ...(typeof obj['receive_id_type'] === 'string'
      ? { receive_id_type: obj['receive_id_type'] as ChannelConfig['receive_id_type'] }
      : {}),
  };
}

function validateWindows(raw: unknown): ClaudeAlertWindow[] {
  if (raw === undefined) return DEFAULTS.alert.windows;
  if (!Array.isArray(raw)) throw new Error('alert.windows 必须是数组');
  return raw.map((w, i) => {
    if (typeof w !== 'string' || !VALID_WINDOWS.includes(w as ClaudeAlertWindow)) {
      throw new Error(`alert.windows[${i}] 非法: ${String(w)}`);
    }
    return w as ClaudeAlertWindow;
  });
}

export async function loadPollConfig(filePath: string): Promise<PollConfig> {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在: ${resolved}`);
    }
    throw error;
  }

  const parsed: unknown = YAML.parse(content) ?? {};
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('配置文件格式无效：不是对象');
  }
  const obj = parsed as Record<string, unknown>;

  const pollRaw = (obj['poll'] as { interval_seconds?: unknown } | undefined) ?? {};
  const interval =
    typeof pollRaw.interval_seconds === 'number' && pollRaw.interval_seconds > 0
      ? pollRaw.interval_seconds
      : DEFAULTS.poll.interval_seconds;

  const alertRaw = (obj['alert'] as { windows?: unknown } | undefined) ?? {};
  const windows = validateWindows(alertRaw.windows);

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  return {
    poll: { interval_seconds: interval },
    alert: { windows },
    channels,
  };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/claude-usage-config.yaml');
```

- [ ] **Step 4.4: Run test to verify pass**

Run: `pnpm test -- __tests__/claude-usage/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4.5: Commit**

```bash
git add src/claude-usage/config.ts __tests__/claude-usage/config.test.ts
git commit -m "feat(claude-usage): add poll config loader"
```

---

## Task 5: claude-usage poll module

**Files:**
- Create: `src/claude-usage/poll.ts`
- Test: `__tests__/claude-usage/poll.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `__tests__/claude-usage/poll.test.ts`:

```ts
import { buildPollReport } from '../../src/claude-usage/poll';
import type { UsageData } from '../../src/claude-usage/types';

const now = 1_700_000_000_000;
const FIVE_H = 5 * 3600 * 1000;
const SEVEN_D = 7 * 24 * 3600 * 1000;

function makeUsage(overrides: Partial<UsageData> = {}): UsageData {
  return {
    fiveHour: { utilization: 20, resetsAt: new Date(now + FIVE_H / 2).toISOString() },
    sevenDay: { utilization: 30, resetsAt: new Date(now + SEVEN_D / 2).toISOString() },
    sevenDaySonnet: null,
    sevenDayOpus: null,
    sevenDayCowork: null,
    extraUsage: null,
    ...overrides,
  };
}

describe('claude-usage buildPollReport', () => {
  test('info level when all windows under linear budget', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 40, resetsAt: new Date(now + FIVE_H / 2).toISOString() }, // expected 50
      sevenDay: { utilization: 40, resetsAt: new Date(now + SEVEN_D / 2).toISOString() }, // expected 50
    });
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
    expect(report.title).toContain('用量');
    expect(report.content).toContain('5 小时');
    expect(report.alerts).toHaveLength(0);
  });

  test('warn level when any configured window breached', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 80, resetsAt: new Date(now + FIVE_H / 2).toISOString() }, // expected 50 → breach
      sevenDay: { utilization: 20, resetsAt: new Date(now + SEVEN_D / 2).toISOString() },
    });
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('告警');
    expect(report.alerts.map((a) => a.window)).toEqual(['five_hour']);
  });

  test('skips windows not in configured list', () => {
    const usage = makeUsage({
      fiveHour: { utilization: 90, resetsAt: new Date(now + FIVE_H / 2).toISOString() }, // would breach
    });
    const report = buildPollReport(usage, {
      windows: ['seven_day'], // five_hour not checked
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
  });

  test('skips null optional windows (sonnet/opus) silently', () => {
    const usage = makeUsage();
    const report = buildPollReport(usage, {
      windows: ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus'],
      nowMs: now,
      subscription: 'pro',
      tier: 'default',
    });
    expect(report.level).toBe('info');
  });
});
```

- [ ] **Step 5.2: Run test to verify failure**

Run: `pnpm test -- __tests__/claude-usage/poll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `poll.ts`**

Create `src/claude-usage/poll.ts`:

```ts
import { getCredentials } from './credentials';
import { fetchUsage } from './api';
import { UsageData, ResetInfo } from './types';
import { PollConfig, ClaudeAlertWindow } from './config';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

interface WindowMeta {
  label: string;
  windowMs: number;
  get: (u: UsageData) => ResetInfo | null;
}

const WINDOWS: Record<ClaudeAlertWindow, WindowMeta> = {
  five_hour: {
    label: '5 小时',
    windowMs: FIVE_HOUR_MS,
    get: (u) => u.fiveHour,
  },
  seven_day: {
    label: '7 天',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDay,
  },
  seven_day_sonnet: {
    label: '7 天 Sonnet',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDaySonnet,
  },
  seven_day_opus: {
    label: '7 天 Opus',
    windowMs: SEVEN_DAY_MS,
    get: (u) => u.sevenDayOpus,
  },
};

export interface ReportOptions {
  windows: ClaudeAlertWindow[];
  nowMs: number;
  subscription: string;
  tier: string;
}

export interface AlertEntry {
  window: ClaudeAlertWindow;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

/** 构造单次轮询的通知消息 + 告警列表（纯函数，易测） */
export function buildPollReport(usage: UsageData, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const key of options.windows) {
    const meta = WINDOWS[key];
    const info = meta.get(usage);
    if (!info) continue;

    const result = checkProrated({
      utilization: info.utilization,
      resetsAtMs: new Date(info.resetsAt).getTime(),
      windowMs: meta.windowMs,
      nowMs: options.nowMs,
    });

    entries.push({ window: key, label: meta.label, utilization: info.utilization, result });

    const prefix = result.breached ? '🚨' : '  ';
    const diffLabel = result.breached
      ? `超 ${result.overBy.toFixed(1)}pp`
      : `差 ${result.overBy.toFixed(1)}pp`;
    lines.push(
      `${prefix} ${meta.label}：${info.utilization.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}`
    );
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 Claude 用量告警' : '📊 Claude 用量报告';

  const header = `**账号**：${options.subscription} ｜ **tier**：${options.tier}`;
  const content = [header, '', ...lines].join('\n');

  const summaryLine = entries
    .map((e) => `${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`)
    .join(' ') + ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  /** 便于测试注入，不传则使用真实 getCredentials/fetchUsage */
  fetcher?: () => Promise<{ usage: UsageData; subscription: string; tier: string }>;
  /** 便于测试注入 */
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  /** 默认 console.log */
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

async function defaultFetcher(): Promise<{ usage: UsageData; subscription: string; tier: string }> {
  const credentials = await getCredentials();
  const usage = await fetchUsage(credentials.accessToken);
  return { usage, subscription: credentials.subscriptionType, tier: credentials.rateLimitTier };
}

/** 执行一次轮询（抓取 + 构造报告 + 分发），被 runPoll 和测试共用 */
export async function runOnce(options: {
  config: PollConfig;
  fetcher?: RunPollOptions['fetcher'];
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const { usage, subscription, tier } = await fetcher();
  const report = buildPollReport(usage, {
    windows: options.config.alert.windows,
    nowMs: Date.now(),
    subscription,
    tier,
  });
  options.logLine(`[${new Date().toISOString()}] ${report.summaryLine}`);

  const results = await Promise.allSettled(
    options.notifiers.map((n) => n.send({ title: report.title, content: report.content, level: report.level }))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      options.logError(`通道 ${options.notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

/** 启动轮询；会立即跑一次，然后按 intervalSec 间隔继续 */
export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        config: options.config,
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        notifiers,
        logLine,
        logError,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] 轮询失败: ${message}`);
    }
  };

  await tick();
  const handle = setInterval(() => {
    if (options.signal.stopped) {
      clearInterval(handle);
      return;
    }
    void tick();
  }, options.intervalSec * 1000);
}
```

- [ ] **Step 5.4: Run test to verify pass**

Run: `pnpm test -- __tests__/claude-usage/poll.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5.5: Commit**

```bash
git add src/claude-usage/poll.ts __tests__/claude-usage/poll.test.ts
git commit -m "feat(claude-usage): add poll loop + linear-prorated alerts"
```

---

## Task 6: Wire `--poll` / `--config` into claude-usage CLI

**Files:**
- Modify: `src/claude-usage/index.ts`

- [ ] **Step 6.1: Update CLI**

Replace full contents of `src/claude-usage/index.ts`:

```ts
#!/usr/bin/env node

import { Command } from 'commander';
import { CommandOptions } from './types';
import { getCredentials } from './credentials';
import { fetchUsage } from './api';
import { displayUsage, clearScreen } from './display';
import { loadPollConfig, DEFAULT_CONFIG_PATH } from './config';
import { runPoll } from './poll';

/** 是否正在关闭 */
const stopSignal = { stopped: false };

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

async function showUsage(options: CommandOptions): Promise<void> {
  try {
    const credentials = await getCredentials();
    const usage = await fetchUsage(credentials.accessToken);

    if (options.json) {
      process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
      return;
    }

    displayUsage(usage, credentials);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    process.stderr.write(`错误: ${message}\n`);
    process.exit(1);
  }
}

async function watchUsage(intervalSeconds: number, options: CommandOptions): Promise<void> {
  const run = async (): Promise<void> => {
    if (stopSignal.stopped) return;
    clearScreen();
    try {
      const credentials = await getCredentials();
      const usage = await fetchUsage(credentials.accessToken);
      if (options.json) {
        process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
      } else {
        displayUsage(usage, credentials);
        process.stdout.write(`  每 ${intervalSeconds} 秒自动刷新，按 Ctrl+C 退出\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      process.stderr.write(`错误: ${message}\n`);
    }
  };

  await run();
  setInterval(() => { void run(); }, intervalSeconds * 1000);
}

function parseSeconds(raw: string | true, defaultSec: number): number {
  const seconds = raw === true ? defaultSec : parseInt(raw, 10);
  if (isNaN(seconds) || seconds < 1) {
    throw new Error('间隔必须为正整数');
  }
  return seconds;
}

setupSignalHandlers();

const program = new Command();

program
  .name('claude-usage')
  .description('Display Claude API usage and quota information')
  .version('1.0.0')
  .option('-w, --watch [seconds]', 'Watch mode: refresh every N seconds (default: 30)')
  .option('-p, --poll [seconds]', 'Headless poll mode: fetch every N seconds and dispatch to channels (default: 300)')
  .option('-c, --config <path>', 'Poll config path (default: ./local/claude-usage-config.yaml)')
  .option('--json', 'Output raw JSON')
  .action(async (options: {
    watch?: string | true;
    poll?: string | true;
    config?: string;
    json?: boolean;
  }) => {
    if (options.watch !== undefined && options.poll !== undefined) {
      process.stderr.write('错误: --watch 与 --poll 互斥\n');
      process.exit(1);
    }

    if (options.poll !== undefined) {
      try {
        const seconds = parseSeconds(options.poll, 300);
        const configPath = options.config ?? DEFAULT_CONFIG_PATH;
        const config = await loadPollConfig(configPath);
        const intervalSec = seconds !== 300 ? seconds : config.poll.interval_seconds;
        process.stdout.write(
          `[${new Date().toISOString()}] claude-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
        );
        await runPoll({ intervalSec, config, signal: stopSignal });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '未知错误';
        process.stderr.write(`错误: ${message}\n`);
        process.exit(1);
      }
      return;
    }

    const commandOptions: CommandOptions = { json: options.json ?? false };

    if (options.watch !== undefined) {
      try {
        const seconds = parseSeconds(options.watch, 30);
        await watchUsage(seconds, commandOptions);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '未知错误';
        process.stderr.write(`错误: ${message}\n`);
        process.exit(1);
      }
      return;
    }

    await showUsage(commandOptions);
  });

program.parse(process.argv);
```

- [ ] **Step 6.2: Build + run full tests**

Run: `pnpm run build && pnpm test`
Expected: build clean, all tests PASS.

- [ ] **Step 6.3: Smoke-test CLI**

Run: `node dist/claude-usage/index.js --help`
Expected: help output includes `--poll` and `--config` flags. No crash.

- [ ] **Step 6.4: Commit**

```bash
git add src/claude-usage/index.ts
git commit -m "feat(claude-usage): add --poll and --config CLI flags"
```

---

## Task 7: codex-usage config loader

**Files:**
- Create: `src/codex-usage/config.ts`
- Test: `__tests__/codex-usage/config.test.ts`

- [ ] **Step 7.1: Write failing test**

Create `__tests__/codex-usage/config.test.ts`:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPollConfig } from '../../src/codex-usage/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('codex-usage loadPollConfig', () => {
  test('loads full config', async () => {
    const file = await writeTemp(`
poll:
  interval_seconds: 60
alert:
  windows: [primary, secondary]
channels:
  - type: feishu
    app_id: cli_x
    app_secret: s
    receive_id: oc_1
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(60);
    expect(cfg.alert.windows).toEqual(['primary', 'secondary']);
    expect(cfg.channels).toHaveLength(1);
  });

  test('default windows = [primary, secondary]', async () => {
    const file = await writeTemp(`channels: []\n`);
    const cfg = await loadPollConfig(file);
    expect(cfg.alert.windows).toEqual(['primary', 'secondary']);
  });

  test('rejects unknown window name', async () => {
    const file = await writeTemp(`
alert:
  windows: [tertiary]
channels: []
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/tertiary/);
  });
});
```

- [ ] **Step 7.2: Run test to verify failure**

Run: `pnpm test -- __tests__/codex-usage/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement `config.ts`**

Create `src/codex-usage/config.ts`:

```ts
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ChannelConfig } from '../shared/notifiers/types';

export type CodexAlertWindow = 'primary' | 'secondary';

const VALID_WINDOWS: readonly CodexAlertWindow[] = ['primary', 'secondary'];

export interface PollConfig {
  poll: { interval_seconds: number };
  alert: { windows: CodexAlertWindow[] };
  channels: ChannelConfig[];
}

const DEFAULTS: PollConfig = {
  poll: { interval_seconds: 300 },
  alert: { windows: ['primary', 'secondary'] },
  channels: [],
};

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`channels[${index}] 不是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') {
    throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
  }
  const required = ['app_id', 'app_secret', 'receive_id'] as const;
  for (const key of required) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
      throw new Error(`channels[${index}].${key} 缺失或为空`);
    }
  }
  return {
    type: 'feishu',
    app_id: obj['app_id'] as string,
    app_secret: obj['app_secret'] as string,
    receive_id: obj['receive_id'] as string,
    ...(typeof obj['domain'] === 'string' ? { domain: obj['domain'] } : {}),
    ...(typeof obj['receive_id_type'] === 'string'
      ? { receive_id_type: obj['receive_id_type'] as ChannelConfig['receive_id_type'] }
      : {}),
  };
}

function validateWindows(raw: unknown): CodexAlertWindow[] {
  if (raw === undefined) return DEFAULTS.alert.windows;
  if (!Array.isArray(raw)) throw new Error('alert.windows 必须是数组');
  return raw.map((w, i) => {
    if (typeof w !== 'string' || !VALID_WINDOWS.includes(w as CodexAlertWindow)) {
      throw new Error(`alert.windows[${i}] 非法: ${String(w)}`);
    }
    return w as CodexAlertWindow;
  });
}

export async function loadPollConfig(filePath: string): Promise<PollConfig> {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在: ${resolved}`);
    }
    throw error;
  }

  const parsed: unknown = YAML.parse(content) ?? {};
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('配置文件格式无效：不是对象');
  }
  const obj = parsed as Record<string, unknown>;

  const pollRaw = (obj['poll'] as { interval_seconds?: unknown } | undefined) ?? {};
  const interval =
    typeof pollRaw.interval_seconds === 'number' && pollRaw.interval_seconds > 0
      ? pollRaw.interval_seconds
      : DEFAULTS.poll.interval_seconds;

  const alertRaw = (obj['alert'] as { windows?: unknown } | undefined) ?? {};
  const windows = validateWindows(alertRaw.windows);

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  return {
    poll: { interval_seconds: interval },
    alert: { windows },
    channels,
  };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/codex-usage-config.yaml');
```

- [ ] **Step 7.4: Run test to verify pass**

Run: `pnpm test -- __tests__/codex-usage/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7.5: Commit**

```bash
git add src/codex-usage/config.ts __tests__/codex-usage/config.test.ts
git commit -m "feat(codex-usage): add poll config loader"
```

---

## Task 8: codex-usage poll module

**Files:**
- Create: `src/codex-usage/poll.ts`
- Test: `__tests__/codex-usage/poll.test.ts`

Key note: Codex `UsageWindow.resetsAt` is **unix seconds** (see `format.ts:36` using `dayjs.unix`). Convert with `* 1000`. `windowMinutes` may be `null` → skip window silently.

- [ ] **Step 8.1: Write failing test**

Create `__tests__/codex-usage/poll.test.ts`:

```ts
import { buildPollReport } from '../../src/codex-usage/poll';
import type { UsageSnapshot } from '../../src/codex-usage/types';

const nowSec = 1_700_000_000;
const nowMs = nowSec * 1000;

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    planType: 'pro',
    primary: { usedPercent: 20, windowMinutes: 300, resetsAt: nowSec + 150 * 60 }, // half-way
    secondary: { usedPercent: 30, windowMinutes: 10080, resetsAt: nowSec + 5040 * 60 },
    additional: [],
    raw: {},
    ...overrides,
  };
}

describe('codex-usage buildPollReport', () => {
  test('info level when all windows under linear budget', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 40, windowMinutes: 300, resetsAt: nowSec + 150 * 60 }, // exp 50 → ok
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
    expect(report.title).toContain('用量');
  });

  test('warn level when breach', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 80, windowMinutes: 300, resetsAt: nowSec + 150 * 60 }, // exp 50 → breach
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('warn');
    expect(report.alerts.map((a) => a.window)).toEqual(['primary']);
  });

  test('skips window with null windowMinutes', () => {
    const snap = makeSnapshot({
      primary: { usedPercent: 99, windowMinutes: null, resetsAt: nowSec + 60 },
    });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
    expect(report.content).toContain('windowMinutes 未知');
  });

  test('skips missing window silently', () => {
    const snap = makeSnapshot({ primary: undefined });
    const report = buildPollReport(snap, {
      windows: ['primary', 'secondary'],
      nowMs,
    });
    expect(report.level).toBe('info');
  });
});
```

- [ ] **Step 8.2: Run test to verify failure**

Run: `pnpm test -- __tests__/codex-usage/poll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `poll.ts`**

Create `src/codex-usage/poll.ts`:

```ts
import { getDefaultAuthPath, loadLocalAuth } from './auth';
import { getUsageSnapshot } from './usage';
import { UsageSnapshot, UsageWindow } from './types';
import { PollConfig, CodexAlertWindow } from './config';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';

interface WindowMeta {
  label: string;
  get: (s: UsageSnapshot) => UsageWindow | undefined;
}

const WINDOWS: Record<CodexAlertWindow, WindowMeta> = {
  primary: { label: 'Primary', get: (s) => s.primary },
  secondary: { label: 'Secondary', get: (s) => s.secondary },
};

export interface ReportOptions {
  windows: CodexAlertWindow[];
  nowMs: number;
}

export interface AlertEntry {
  window: CodexAlertWindow;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

export function buildPollReport(snapshot: UsageSnapshot, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const key of options.windows) {
    const meta = WINDOWS[key];
    const win = meta.get(snapshot);
    if (!win) continue;

    if (!win.windowMinutes || win.windowMinutes <= 0) {
      lines.push(`  ${meta.label}：${win.usedPercent.toFixed(1)}% ｜windowMinutes 未知，跳过告警判定`);
      continue;
    }

    const result = checkProrated({
      utilization: win.usedPercent,
      resetsAtMs: (win.resetsAt ?? 0) * 1000,
      windowMs: win.windowMinutes * 60_000,
      nowMs: options.nowMs,
    });

    entries.push({ window: key, label: meta.label, utilization: win.usedPercent, result });

    const prefix = result.breached ? '🚨' : '  ';
    const diffLabel = result.breached
      ? `超 ${result.overBy.toFixed(1)}pp`
      : `差 ${result.overBy.toFixed(1)}pp`;
    lines.push(
      `${prefix} ${meta.label}：${win.usedPercent.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}`
    );
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 Codex 用量告警' : '📊 Codex 用量报告';
  const header = `**Plan**：${snapshot.planType}`;
  const content = [header, '', ...lines].join('\n');

  const summaryLine = entries
    .map((e) => `${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`)
    .join(' ') + ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  authFile?: string;
  baseUrl?: string;
  fetcher?: () => Promise<UsageSnapshot>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

async function defaultFetcher(authFile: string, baseUrl: string): Promise<UsageSnapshot> {
  const auth = await loadLocalAuth(authFile);
  return getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    baseUrl,
  });
}

export async function runOnce(options: {
  config: PollConfig;
  fetcher: () => Promise<UsageSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot, {
    windows: options.config.alert.windows,
    nowMs: Date.now(),
  });
  options.logLine(`[${new Date().toISOString()}] ${report.summaryLine}`);

  const results = await Promise.allSettled(
    options.notifiers.map((n) => n.send({ title: report.title, content: report.content, level: report.level }))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      options.logError(`通道 ${options.notifiers[i]?.name ?? i} 发送失败: ${reason}`);
    }
  });
}

export async function runPoll(options: RunPollOptions): Promise<void> {
  const notifiers = options.notifiersOverride ?? buildNotifiers(options.config.channels);
  const logLine = options.logLine ?? ((l) => process.stdout.write(l + '\n'));
  const logError = options.logError ?? ((l) => process.stderr.write(l + '\n'));
  const authFile = options.authFile ?? getDefaultAuthPath();
  const baseUrl = options.baseUrl ?? 'https://chatgpt.com/backend-api';
  const fetcher = options.fetcher ?? (() => defaultFetcher(authFile, baseUrl));

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({
        config: options.config,
        fetcher,
        notifiers,
        logLine,
        logError,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] 轮询失败: ${message}`);
    }
  };

  await tick();
  const handle = setInterval(() => {
    if (options.signal.stopped) {
      clearInterval(handle);
      return;
    }
    void tick();
  }, options.intervalSec * 1000);
}
```

- [ ] **Step 8.4: Run test to verify pass**

Run: `pnpm test -- __tests__/codex-usage/poll.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8.5: Commit**

```bash
git add src/codex-usage/poll.ts __tests__/codex-usage/poll.test.ts
git commit -m "feat(codex-usage): add poll loop + linear-prorated alerts"
```

---

## Task 9: Wire `--poll` / `--config` into codex-usage CLI

**Files:**
- Modify: `src/codex-usage/index.ts`

- [ ] **Step 9.1: Update CLI**

Replace full contents of `src/codex-usage/index.ts`:

```ts
#!/usr/bin/env node

import { Command } from 'commander';
import { getDefaultAuthPath, loadLocalAuth } from './auth';
import { formatUsageTable } from './format';
import { getUsageSnapshot } from './usage';
import { loadPollConfig, DEFAULT_CONFIG_PATH } from './config';
import { runPoll } from './poll';

const stopSignal = { stopped: false };

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function setupSignalHandlers(): void {
  const cleanup = () => {
    if (stopSignal.stopped) return;
    stopSignal.stopped = true;
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

export function parseSeconds(raw: string | true, defaultSec: number): number {
  const seconds = raw === true ? defaultSec : parseInt(raw ?? '', 10);
  if (isNaN(seconds) || seconds < 1) {
    throw new Error('interval must be a positive integer');
  }
  return seconds;
}

interface CliOptions {
  json?: boolean;
  authFile: string;
  baseUrl: string;
  watch?: string | true;
  poll?: string | true;
  config?: string;
}

async function printSnapshot(options: CliOptions): Promise<void> {
  const auth = await loadLocalAuth(options.authFile);
  const snapshot = await getUsageSnapshot({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    baseUrl: options.baseUrl,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return;
  }

  process.stdout.write(formatUsageTable(snapshot) + '\n');
}

async function watchUsage(intervalSeconds: number, options: CliOptions): Promise<void> {
  const run = async (): Promise<void> => {
    if (stopSignal.stopped) return;
    clearScreen();
    try {
      await printSnapshot(options);
      if (!options.json) {
        process.stdout.write(`\nRefreshing every ${intervalSeconds} seconds. Press Ctrl+C to exit.\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    }
  };

  await run();
  setInterval(() => { void run(); }, intervalSeconds * 1000);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('codex-usage')
    .description('Read Codex/ChatGPT usage data using the local ChatGPT login')
    .option('-w, --watch [seconds]', 'refresh every N seconds (default: 30)')
    .option('-p, --poll [seconds]', 'headless poll every N seconds and dispatch to channels (default: 300)')
    .option('-c, --config <path>', 'Poll config path (default: ./local/codex-usage-config.yaml)')
    .option('--json', 'print raw normalized JSON')
    .option('--auth-file <path>', 'path to auth.json', getDefaultAuthPath())
    .option('--base-url <url>', 'override usage base URL', 'https://chatgpt.com/backend-api');

  program.action(async (options: CliOptions) => {
    if (options.watch !== undefined && options.poll !== undefined) {
      process.stderr.write('error: --watch and --poll are mutually exclusive\n');
      process.exit(1);
    }

    if (options.poll !== undefined) {
      const seconds = parseSeconds(options.poll, 300);
      const configPath = options.config ?? DEFAULT_CONFIG_PATH;
      const config = await loadPollConfig(configPath);
      const intervalSec = seconds !== 300 ? seconds : config.poll.interval_seconds;
      process.stdout.write(
        `[${new Date().toISOString()}] codex-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
      );
      await runPoll({
        intervalSec,
        config,
        signal: stopSignal,
        authFile: options.authFile,
        baseUrl: options.baseUrl,
      });
      return;
    }

    if (options.watch !== undefined) {
      await watchUsage(parseSeconds(options.watch, 30), options);
      return;
    }

    await printSnapshot(options);
  });

  return program;
}

if (require.main === module) {
  setupSignalHandlers();
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 9.2: Build + test**

Run: `pnpm run build && pnpm test`
Expected: build clean, all tests PASS.

- [ ] **Step 9.3: Smoke-test CLI**

Run: `node dist/codex-usage/index.js --help`
Expected: help output includes `--poll` and `--config`. No crash.

- [ ] **Step 9.4: Commit**

```bash
git add src/codex-usage/index.ts
git commit -m "feat(codex-usage): add --poll and --config CLI flags"
```

---

## Task 10: Sample configs + PM2 ecosystem

**Files:**
- Create: `local/claude-usage-config.yaml`
- Create: `local/codex-usage-config.yaml`
- Create: `local/pm2.config.js`

- [ ] **Step 10.1: Create `local/claude-usage-config.yaml`**

```yaml
# claude-usage 轮询配置
# 每 interval_seconds 执行一次：拉取用量 → 线性预算判定 → 推送到每个通道
poll:
  interval_seconds: 300

alert:
  # 要做线性预算告警的窗口，可选：
  #   five_hour | seven_day | seven_day_sonnet | seven_day_opus
  windows:
    - five_hour
    - seven_day

channels:
  # 飞书通道。如需关闭，把本节注释或留空列表即可。
  - type: feishu
    app_id: "REPLACE_WITH_APP_ID"
    app_secret: "REPLACE_WITH_APP_SECRET"
    # domain: https://open.feishu.cn    # 默认值，国际版改为 https://open.larksuite.com
    receive_id: "REPLACE_WITH_CHAT_OR_USER_ID"
    receive_id_type: chat_id            # chat_id | open_id | user_id | email
```

- [ ] **Step 10.2: Create `local/codex-usage-config.yaml`**

```yaml
# codex-usage 轮询配置
poll:
  interval_seconds: 300

alert:
  # 要做线性预算告警的窗口：primary | secondary
  windows:
    - primary
    - secondary

channels:
  - type: feishu
    app_id: "REPLACE_WITH_APP_ID"
    app_secret: "REPLACE_WITH_APP_SECRET"
    receive_id: "REPLACE_WITH_CHAT_OR_USER_ID"
    receive_id_type: chat_id
```

- [ ] **Step 10.3: Create `local/pm2.config.js`**

```js
// PM2 ecosystem — 管理 claude-usage / codex-usage 轮询进程
// 用法：
//   pnpm run build
//   pm2 start local/pm2.config.js
//   pm2 save
//   pm2 startup        # 按提示执行 sudo 命令以启用开机自启
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'claude-usage-poll',
      script: 'dist/claude-usage/index.js',
      args: '--poll 300 --config ./local/claude-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/claude-usage.out.log',
      err_file: './local/logs/claude-usage.err.log',
      time: true,
    },
    {
      name: 'codex-usage-poll',
      script: 'dist/codex-usage/index.js',
      args: '--poll 300 --config ./local/codex-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/codex-usage.out.log',
      err_file: './local/logs/codex-usage.err.log',
      time: true,
    },
  ],
};
```

- [ ] **Step 10.4: Smoke-test config loader against real sample**

Run: `node -e "require('./dist/claude-usage/config.js').loadPollConfig('./local/claude-usage-config.yaml').then(c => console.log(JSON.stringify(c, null, 2))).catch(e => { console.error(e.message); process.exit(1); })"`
Expected: prints parsed config with the REPLACE_* placeholders. No crash.

Run: `node -e "require('./dist/codex-usage/config.js').loadPollConfig('./local/codex-usage-config.yaml').then(c => console.log(JSON.stringify(c, null, 2))).catch(e => { console.error(e.message); process.exit(1); })"`
Expected: same, for codex.

- [ ] **Step 10.5: Commit**

```bash
git add local/claude-usage-config.yaml local/codex-usage-config.yaml local/pm2.config.js
git commit -m "feat: add sample usage poll configs and PM2 ecosystem file"
```

---

## Task 11: Update docs

**Files:**
- Modify: `docs/claude-usage.md`
- Modify: `docs/codex-usage.md`

- [ ] **Step 11.1: Read existing `docs/claude-usage.md`**

Run: `cat docs/claude-usage.md`
(Review current structure — this is a context-gathering step, not an edit.)

- [ ] **Step 11.2: Append poll + PM2 section to `docs/claude-usage.md`**

Append the following section at the bottom of `docs/claude-usage.md`:

```markdown
## 轮询 + 通知 + PM2 自启

除交互式 `--watch` 外，`claude-usage` 支持 headless 轮询模式，按间隔抓取用量并把结果（含"线性预算"告警判定）推送到配置的通道。

### 配置

复制 `local/claude-usage-config.yaml`（仓库内已提供样例），填入飞书凭据：

```yaml
poll:
  interval_seconds: 300
alert:
  windows: [five_hour, seven_day]     # 可选: five_hour | seven_day | seven_day_sonnet | seven_day_opus
channels:
  - type: feishu
    app_id: "cli_..."
    app_secret: "..."
    receive_id: "oc_..."
    receive_id_type: chat_id           # chat_id | open_id | user_id | email
```

### 命令行

```bash
claude-usage --poll 300 --config ./local/claude-usage-config.yaml
```

- `--poll [seconds]`：间隔秒数（不传则用配置文件里的 `poll.interval_seconds`，默认 300）。
- `--config <path>`：配置文件路径（默认 `./local/claude-usage-config.yaml`）。
- 与 `--watch` 互斥。

### 线性预算告警

对配置中的每个窗口计算 `expected = 已过去时间 / 窗口总长 × 100`；若 `utilization > expected`，视为超标。消息 header 变红，超标行前缀 🚨。示例：用到第 1 天（7 天窗口）实际 15%，线性预算 ≈ 14.3%，触发告警。

### PM2 后台运行

仓库已在 `local/pm2.config.js` 提供 ecosystem 文件：

```bash
pnpm install -g pm2      # 或 pnpm add -g pm2
pnpm run build
pm2 start local/pm2.config.js
pm2 save
pm2 startup              # 按提示执行 sudo 命令以启用开机自启
```

日志位于 `local/logs/claude-usage.{out,err}.log`。停止：`pm2 stop claude-usage-poll`。
```

- [ ] **Step 11.3: Append matching section to `docs/codex-usage.md`**

Append the following section at the bottom of `docs/codex-usage.md`:

```markdown
## 轮询 + 通知 + PM2 自启

`codex-usage` 也支持 headless 轮询模式；行为与 `claude-usage` 一致，仅窗口名不同。

### 配置

复制 `local/codex-usage-config.yaml`，填入飞书凭据：

```yaml
poll:
  interval_seconds: 300
alert:
  windows: [primary, secondary]
channels:
  - type: feishu
    app_id: "cli_..."
    app_secret: "..."
    receive_id: "oc_..."
    receive_id_type: chat_id
```

注：若 `primary.windowMinutes` 为 `null`（服务端未返回窗口长度），该窗口的告警判定会被跳过，但用量百分比仍然会出现在消息中。

### 命令行

```bash
codex-usage --poll 300 --config ./local/codex-usage-config.yaml
```

### PM2

和 `claude-usage` 共用 `local/pm2.config.js`（`codex-usage-poll` 条目）；`pm2 start local/pm2.config.js` 会同时启动两个进程。
```

- [ ] **Step 11.4: Commit**

```bash
git add docs/claude-usage.md docs/codex-usage.md
git commit -m "docs: document poll mode + notify channels + PM2"
```

---

## Task 12: Full verification pass

- [ ] **Step 12.1: Clean build**

Run: `pnpm run build`
Expected: no TypeScript errors.

- [ ] **Step 12.2: Full test suite**

Run: `pnpm test`
Expected: all tests PASS. Note any new tests count: prorated (7) + feishu (5) + claude-usage config (5) + claude-usage poll (4) + codex-usage config (3) + codex-usage poll (4) = 28 new tests.

- [ ] **Step 12.3: CLI smoke tests**

Run: `node dist/claude-usage/index.js --help`
Expected: `--poll`, `--config`, `--watch`, `--json` all listed.

Run: `node dist/codex-usage/index.js --help`
Expected: `--poll`, `--config`, `--watch`, `--json`, `--auth-file`, `--base-url` all listed.

- [ ] **Step 12.4: Negative CLI check**

Run: `node dist/claude-usage/index.js --poll 10 --watch 10`
Expected: stderr prints "错误: --watch 与 --poll 互斥" and exit code 1.

Run: `node dist/codex-usage/index.js --poll 10 --watch 10`
Expected: stderr prints "error: --watch and --poll are mutually exclusive" and exit code 1.

- [ ] **Step 12.5: Verify task-runner still works (regression)**

Run: `pnpm test -- __tests__/claude-task-runner __tests__/codex-task-runner`
Expected: all pre-existing task-runner tests PASS (feishu re-export should not regress behavior).

---

## Notes for the executing agent

- **Do not add backwards-compat shims** beyond what's explicitly spec'd (the `claude-task-runner/feishu.ts` re-export). If a type name conflicts, rename rather than aliasing.
- **Do not generalize** the notifier abstraction beyond Feishu. The next contributor can add webhook/Slack.
- **Do not pre-build PM2 logs directory**; PM2 creates it on start.
- Commander's `.option('-p, --poll [seconds]', ...)` means the flag is optional-argument. A bare `--poll` sets `options.poll === true` and `parseSeconds` falls back to the default. Keep that behavior.
- If `pnpm test` is slow, scope to the file under development with `pnpm test -- <path>`.
