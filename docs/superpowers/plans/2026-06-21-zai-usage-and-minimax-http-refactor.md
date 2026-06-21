# zai-usage + minimax HTTP 重构 + 告警统一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `zai-usage` 查询智谱用量并发布飞书；把 `minimax-usage` 从 `mmx-cli` 重构为纯 HTTP；两者告警统一接入 `checkProrated`。

**Architecture:** 复刻 `minimax-usage` 的文件结构（index/config/env/quota/format/poll/types）。数据获取层用全局 `fetch` + `Bearer` 鉴权。告警复用 `shared/alert/prorated.ts` 的 `checkProrated`，通知复用 `shared/notifiers`。实现顺序：③ zai-usage（零回归）→ ② minimax HTTP 重构 → 告警穿插。

**Tech Stack:** TypeScript (CommonJS, target ES2022), commander, yaml, ts-jest, Node 全局 `fetch`。

## Global Constraints

- 语言：所有面向用户文本、注释、commit message 用中文（项目约定，CLAUDE.md）。
- 命名：新工具 `zai-usage`；bin 注册到 `package.json`。
- 测试：Jest + ts-jest，测试目录 `__tests__/<tool>/` 镜像 `src/<tool>/`；`@/` alias → `src/`。
- 不引入新 npm 依赖（`fetch` 用 Node 内置全局，已有 `zod`/`yaml`/`commander` 足够）。
- minimax 不保留 `mmx-cli` fallback。
- minimax 默认 host `https://api.minimaxi.com`（国内）；zai 默认 host `https://api.z.ai`（国际）。
- 环境变量：minimax `MINIMAX_API_KEY`（不变）；zai `Z_API_KEY`。
- 飞书通知复用 `shared/notifiers` 的 `buildNotifiers` → `FeishuNotifier`。
- 每个 task 结束都要跑 `pnpm test` 相关文件 + commit。

## File Structure

新增：
- `src/zai-usage/index.ts` — commander CLI
- `src/zai-usage/config.ts` — YAML 配置加载
- `src/zai-usage/env.ts` — dotenv 读 `Z_API_KEY`
- `src/zai-usage/quota.ts` — fetch + 归一化
- `src/zai-usage/format.ts` — 文本格式化
- `src/zai-usage/poll.ts` — buildPollReport + runPoll
- `src/zai-usage/types.ts` — 类型
- `__tests__/zai-usage/{types,quota,config,format,poll,env,index}.test.ts`
- `local/zai-usage-config.example.yaml` — 配置示例

修改：
- `src/minimax-usage/quota.ts` — spawn → fetch
- `src/minimax-usage/poll.ts` — checkProrated 告警
- `src/minimax-usage/config.ts` — 加 `alert.windows`
- `src/minimax-usage/types.ts` — snapshot 加 `planName`
- `src/minimax-usage/index.ts` — 加 `--api-host`
- `src/minimax-usage/format.ts` — 报告格式对齐（线性预算行）
- `__tests__/minimax-usage/{quota,poll,config,index}.test.ts` — 适配
- `package.json` — 注册 `zai-usage` bin

---

## Task 1: zai-usage types

**Files:**
- Create: `src/zai-usage/types.ts`
- Test: `__tests__/zai-usage/types.test.ts`

**Interfaces:**
- Produces: `ZaiRawLimit`, `ZaiRawQuotaResponse`, `ZaiLimitType`, `ZaiLimitWindow`, `ZaiUsageSnapshot`（供 Task 2/4/5 使用）

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/types.test.ts`:
```typescript
import 'jest';
import type {
  ZaiLimitType,
  ZaiLimitWindow,
  ZaiUsageSnapshot,
  ZaiRawQuotaResponse,
} from '@/zai-usage/types';

describe('zai-usage types', () => {
  test('limit type union is narrow', () => {
    const a: ZaiLimitType = 'TOKENS_LIMIT';
    const b: ZaiLimitType = 'TIME_LIMIT';
    expect([a, b]).toEqual(['TOKENS_LIMIT', 'TIME_LIMIT']);
  });

  test('window shape compiles', () => {
    const w: ZaiLimitWindow = {
      type: 'TOKENS_LIMIT',
      windowMinutes: 300,
      windowLabel: '5 hour window',
      usage: 100,
      remaining: 80,
      currentValue: 20,
      usedPercent: 20,
      resetsAtMs: 123,
      usageDetails: [{ modelCode: 'glm-4.6', usage: 10 }],
    };
    expect(w.usedPercent).toBe(20);
  });

  test('snapshot shape compiles', () => {
    const s: ZaiUsageSnapshot = {
      planName: 'Pro',
      primary: null,
      secondary: null,
      raw: {} as ZaiRawQuotaResponse,
    };
    expect(s.planName).toBe('Pro');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/types.test.ts`
Expected: FAIL — `Cannot find module '@/zai-usage/types'`

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/types.ts`:
```typescript
export type ZaiLimitType = 'TOKENS_LIMIT' | 'TIME_LIMIT';

/** 原始 limits[] 单项（字段全部按 unknown 容错，由 quota.ts 归一化） */
export interface ZaiRawLimit {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
  usage?: unknown;
  currentValue?: unknown;
  remaining?: unknown;
  percentage?: unknown;
  nextResetTime?: unknown;
  usageDetails?: unknown;
  [key: string]: unknown;
}

export interface ZaiRawQuotaResponse {
  code?: unknown;
  msg?: unknown;
  success?: unknown;
  data?: { limits?: unknown; planName?: unknown; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface ZaiUsageDetail {
  modelCode: string;
  usage: number;
}

/** 归一化后的单个用量窗口 */
export interface ZaiLimitWindow {
  type: ZaiLimitType;
  windowMinutes: number | null;
  windowLabel: string | null;
  usage: number | null;
  remaining: number | null;
  currentValue: number | null;
  usedPercent: number | null;
  resetsAtMs: number | null;
  usageDetails: ZaiUsageDetail[];
}

/** 归一化后的智谱用量快照 */
export interface ZaiUsageSnapshot {
  planName: string | null;
  primary: ZaiLimitWindow | null;
  secondary: ZaiLimitWindow | null;
  raw: ZaiRawQuotaResponse;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/types.ts __tests__/zai-usage/types.test.ts
git commit -m "feat(zai-usage): 定义用量查询类型"
```

---

## Task 2: zai-usage quota (fetch + 归一化)

**Files:**
- Create: `src/zai-usage/quota.ts`
- Test: `__tests__/zai-usage/quota.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ZaiRaw*` / `ZaiLimitWindow` / `ZaiUsageSnapshot`
- Produces: `fetchZaiUsage(options: { apiKey: string; apiHost?: string; fetchImpl?: typeof fetch; }): Promise<ZaiUsageSnapshot>`、`normalizeZaiUsage(raw: ZaiRawQuotaResponse): ZaiUsageSnapshot`、`parseZaiLimitUnit(unit: unknown): { minutes: number | null; label: string | null }`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/quota.test.ts`（响应样例取自 CodexBar `ZaiProviderTests.swift`）:
```typescript
import { normalizeZaiUsage, parseZaiLimitUnit } from '@/zai-usage/quota';

describe('zai-usage quota normalize', () => {
  test('parses usage response — primary=TOKENS, secondary=TIME', () => {
    const snapshot = normalizeZaiUsage({
      code: 200,
      msg: 'Operation successful',
      success: true,
      data: {
        limits: [
          {
            type: 'TIME_LIMIT', unit: 5, number: 1, usage: 100,
            currentValue: 102, remaining: 0, percentage: 100,
            usageDetails: [{ modelCode: 'search-prime', usage: 95 }],
          },
          {
            type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 40000000,
            currentValue: 13628365, remaining: 26371635, percentage: 34,
            nextResetTime: 1768507567547,
          },
        ],
        planName: 'Pro',
      },
    });
    expect(snapshot.planName).toBe('Pro');
    // primary = TOKENS_LIMIT，已用% = (40000000-26371635)/40000000*100 = 34.08...
    expect(snapshot.primary?.type).toBe('TOKENS_LIMIT');
    expect(snapshot.primary?.usedPercent).toBeCloseTo(34.08, 1);
    expect(snapshot.primary?.windowMinutes).toBe(300);
    expect(snapshot.primary?.resetsAtMs).toBe(1768507567547);
    // secondary = TIME_LIMIT
    expect(snapshot.secondary?.type).toBe('TIME_LIMIT');
    expect(snapshot.secondary?.usageDetails[0]?.modelCode).toBe('search-prime');
  });

  test('three limits — primary 取最长 TOKENS 窗口, session 归 secondary', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25, nextResetTime: 1775020168897 },
          { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 9, nextResetTime: 1775588029998 },
          { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 224, remaining: 776, percentage: 22 },
        ],
        level: 'pro',
      },
    });
    // 两个 TOKENS_LIMIT：最长窗口(weeks=10080min)为 primary，最短(hours=300min)为 secondary
    expect(snapshot.primary?.windowMinutes).toBe(10080);
    expect(snapshot.primary?.usedPercent).toBe(9);
    expect(snapshot.secondary?.windowMinutes).toBe(300);
    expect(snapshot.secondary?.usedPercent).toBe(25);
  });

  test('missing fields — 回退 percentage', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1, nextResetTime: 1770724088678 },
        ],
      },
    });
    expect(snapshot.primary?.usedPercent).toBe(1);
    expect(snapshot.primary?.usage).toBeNull();
    expect(snapshot.primary?.windowMinutes).toBe(300);
    expect(snapshot.secondary).toBeNull();
  });

  test('usedPercent 优先用 (usage-remaining)，缺失则用 currentValue', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true,
      data: { limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 20, remaining: null, percentage: 25 },
      ] },
    });
    expect(snapshot.primary?.usedPercent).toBe(20);
  });

  test('success without limits — primary/secondary 均 null', () => {
    const snapshot = normalizeZaiUsage({
      code: 200, success: true, data: { planName: 'Pro' },
    });
    expect(snapshot.planName).toBe('Pro');
    expect(snapshot.primary).toBeNull();
    expect(snapshot.secondary).toBeNull();
  });

  test('throws when code !== 200 / success false', () => {
    expect(() => normalizeZaiUsage({ code: 1001, msg: 'Authorization Token Missing', success: false }))
      .toThrow('Authorization Token Missing');
  });

  test('throws when success but no data', () => {
    expect(() => normalizeZaiUsage({ code: 200, msg: 'Operation successful', success: true }))
      .toThrow('Missing data');
  });
});

describe('zai-usage parseZaiLimitUnit', () => {
  test('maps unit codes', () => {
    expect(parseZaiLimitUnit(1)).toEqual({ minutes: 1, label: 'minute' });
    expect(parseZaiLimitUnit(3)).toEqual({ minutes: 300, label: '5 hour' });
    expect(parseZaiLimitUnit(5)).toEqual({ minutes: 1440, label: '1 day' });
    expect(parseZaiLimitUnit(6)).toEqual({ minutes: 10080, label: '1 week' });
    expect(parseZaiLimitUnit(0)).toEqual({ minutes: null, label: null });
    expect(parseZaiLimitUnit(undefined)).toEqual({ minutes: null, label: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/quota.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/quota.ts`:
```typescript
import {
  ZaiLimitType,
  ZaiLimitWindow,
  ZaiRawLimit,
  ZaiRawQuotaResponse,
  ZaiUsageDetail,
  ZaiUsageSnapshot,
} from './types';

export const DEFAULT_ZAI_HOST = 'https://api.z.ai';
const QUOTA_PATH = 'api/monitor/usage/quota/limit';

export interface FetchZaiUsageOptions {
  apiKey: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** unit code → 分钟数 + 人类可读标签（不含 "window" 后缀） */
export function parseZaiLimitUnit(unit: unknown): { minutes: number | null; label: string | null } {
  const code = asNumber(unit);
  if (code === null) return { minutes: null, label: null };
  switch (code) {
    case 1: return { minutes: 1, label: 'minute' };
    case 3: return { minutes: 60, label: 'hour' };
    case 5: return { minutes: 1440, label: 'day' };
    case 6: return { minutes: 10080, label: 'week' };
    default: return { minutes: null, label: null };
  }
}

function windowMinutes(type: ZaiLimitType, unit: unknown, number: unknown): number | null {
  const { minutes: unitMinutes } = parseZaiLimitUnit(unit);
  const n = asNumber(number);
  if (unitMinutes === null || n === null || n <= 0) return null;
  return type === 'TOKENS_LIMIT' ? unitMinutes * n : null;
}

function windowLabel(type: ZaiLimitType, unit: unknown, number: unknown): string | null {
  const { label } = parseZaiLimitUnit(unit);
  const n = asNumber(number);
  if (label === null || n === null || n <= 0) return null;
  const suffix = n === 1 ? label : `${label}s`;
  const base = `${n} ${suffix} window`;
  // TIME_LIMIT 且 unit=5(number=1) 按 CodexBar 显示为 Monthly
  return type === 'TIME_LIMIT' && asNumber(unit) === 5 ? 'Monthly' : base;
}

function computeUsedPercent(limit: ZaiRawLimit): number | null {
  const usage = asNumber(limit.usage);
  const remaining = asNumber(limit.remaining);
  const currentValue = asNumber(limit.currentValue);
  const percentage = asNumber(limit.percentage);

  if (usage !== null && usage > 0) {
    let usedRaw: number | null = null;
    if (remaining !== null) {
      const fromRemaining = usage - remaining;
      usedRaw = currentValue !== null ? Math.max(fromRemaining, currentValue) : fromRemaining;
    } else if (currentValue !== null) {
      usedRaw = currentValue;
    }
    if (usedRaw !== null) {
      const used = Math.max(0, Math.min(usage, usedRaw));
      return Math.min(100, Math.max(0, (used / usage) * 100));
    }
  }
  return percentage;
}

function normalizeUsageDetails(raw: unknown): ZaiUsageDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ZaiUsageDetail | null => {
      if (typeof item !== 'object' || item === null) return null;
      const obj = item as Record<string, unknown>;
      const modelCode = typeof obj.modelCode === 'string' ? obj.modelCode : null;
      const usage = asNumber(obj.usage);
      if (modelCode === null || usage === null) return null;
      return { modelCode, usage };
    })
    .filter((x): x is ZaiUsageDetail => x !== null);
}

function normalizeWindow(limit: ZaiRawLimit): ZaiLimitWindow | null {
  const type = typeof limit.type === 'string' && (limit.type === 'TOKENS_LIMIT' || limit.type === 'TIME_LIMIT')
    ? (limit.type as ZaiLimitType)
    : null;
  if (type === null) return null;
  return {
    type,
    windowMinutes: windowMinutes(type, limit.unit, limit.number),
    windowLabel: windowLabel(type, limit.unit, limit.number),
    usage: asNumber(limit.usage),
    remaining: asNumber(limit.remaining),
    currentValue: asNumber(limit.currentValue),
    usedPercent: computeUsedPercent(limit),
    resetsAtMs: asNumber(limit.nextResetTime),
    usageDetails: normalizeUsageDetails(limit.usageDetails),
  };
}

export function normalizeZaiUsage(raw: ZaiRawQuotaResponse): ZaiUsageSnapshot {
  const code = asNumber(raw.code);
  const success = raw.success === true;
  if (!success || code !== 200) {
    throw new Error(typeof raw.msg === 'string' && raw.msg ? raw.msg : `Z.ai 用量查询失败 (code=${code ?? '?'})`);
  }
  const data = raw.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Missing data');
  }
  const limitsRaw = Array.isArray(data.limits) ? (data.limits as ZaiRawLimit[]) : [];
  const windows = limitsRaw.map(normalizeWindow).filter((w): w is ZaiLimitWindow => w !== null);

  const tokens = windows.filter((w) => w.type === 'TOKENS_LIMIT');
  const times = windows.filter((w) => w.type === 'TIME_LIMIT');

  let primary: ZaiLimitWindow | null = null;
  let secondary: ZaiLimitWindow | null = null;

  if (tokens.length >= 2) {
    const sorted = [...tokens].sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
    secondary = sorted[0] ?? null; // 最短 → secondary
    primary = sorted[sorted.length - 1] ?? null; // 最长 → primary
  } else if (tokens.length === 1) {
    primary = tokens[0] ?? null;
    if (times.length > 0) secondary = times[0] ?? null;
  } else if (times.length > 0) {
    primary = times[0] ?? null;
  }

  const planName = typeof data.planName === 'string' && data.planName.trim().length > 0
    ? data.planName.trim()
    : null;

  return { planName, primary, secondary, raw };
}

function buildQuotaUrl(apiHost: string): string {
  const base = apiHost.replace(/\/+$/, '');
  return `${base}/${QUOTA_PATH}`;
}

export async function fetchZaiUsage(options: FetchZaiUsageOptions): Promise<ZaiUsageSnapshot> {
  const doFetch = options.fetchImpl ?? fetch;
  const host = options.apiHost ?? DEFAULT_ZAI_HOST;
  const response = await doFetch(buildQuotaUrl(host), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Z.ai 用量查询失败 (HTTP ${response.status}): ${body || 'unknown error'}`);
  }
  if (body.trim().length === 0) {
    throw new Error('Z.ai 返回空响应 (HTTP 200)，请检查 API 区域与 token');
  }
  return normalizeZaiUsage(JSON.parse(body) as ZaiRawQuotaResponse);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/quota.test.ts`
Expected: PASS (全部 8 + 1 个用例)

> 注：`windowLabel` 的 TIME_LIMIT unit=5 情形在 normalize 测试里通过 `parses usage response`（secondary=TIME）间接覆盖；若想显式断言可补一个用例验证 `secondary?.windowLabel === 'Monthly'`。

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/quota.ts __tests__/zai-usage/quota.test.ts
git commit -m "feat(zai-usage): HTTP fetch + 用量归一化"
```

---

## Task 3: zai-usage env (dotenv 读 Z_API_KEY)

**Files:**
- Create: `src/zai-usage/env.ts`
- Test: `__tests__/zai-usage/env.test.ts`

**Interfaces:**
- Produces: `DEFAULT_ENV_FILE`、`DEFAULT_API_KEY_ENV = 'Z_API_KEY'`、`readZaiApiKey(options): Promise<string>`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/env.test.ts`:
```typescript
import { parseDotEnv, readZaiApiKey, DEFAULT_API_KEY_ENV } from '@/zai-usage/env';

describe('zai-usage env', () => {
  test('default api key env name is Z_API_KEY', () => {
    expect(DEFAULT_API_KEY_ENV).toBe('Z_API_KEY');
  });

  test('parseDotEnv parses and unquotes', () => {
    const map = parseDotEnv('Z_API_KEY="abc"\nexport OTHER=1\n# comment\n');
    expect(map.Z_API_KEY).toBe('abc');
    expect(map.OTHER).toBe('1');
  });

  test('readZaiApiKey prefers file values then process.env', async () => {
    const tmp = require('path').join(require('os').tmpdir(), `zai-env-${Date.now()}.env`);
    require('fs').writeFileSync(tmp, "Z_API_KEY=fromfile\n");
    expect(await readZaiApiKey({ envFile: tmp, apiKeyEnv: 'Z_API_KEY' })).toBe('fromfile');
  });

  test('readZaiApiKey throws when missing', async () => {
    await expect(readZaiApiKey({ envFile: '/nonexistent/.env', apiKeyEnv: 'Z_API_KEY' }))
      .rejects.toThrow(/未找到 Z_API_KEY/);
  });
});
```

> 注：第 4 个用例依赖 `process.env.Z_API_KEY` 未设置；若 CI 环境设了该变量会干扰。实现里应允许测试覆盖——见 Step 3 的 fallback 顺序（file → process.env）。若担心污染，可在测试开头 `delete process.env.Z_API_KEY`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/env.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/env.ts`（与 `minimax-usage/env.ts` 同款逻辑）:
```typescript
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export const DEFAULT_ENV_FILE = '~/Documents/knowledge/local/.env';
export const DEFAULT_API_KEY_ENV = 'Z_API_KEY';

export function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    result[key] = unquote(normalized.slice(index + 1));
  }
  return result;
}

export async function loadDotEnv(filePath: string): Promise<Record<string, string>> {
  const resolved = path.resolve(expandHome(filePath));
  const content = await fs.readFile(resolved, 'utf-8');
  return parseDotEnv(content);
}

export async function readZaiApiKey(options: { envFile: string; apiKeyEnv: string }): Promise<string> {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = await loadDotEnv(options.envFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const value = fileValues[options.apiKeyEnv] ?? process.env[options.apiKeyEnv];
  if (!value || value.trim().length === 0) {
    throw new Error(`未找到 ${options.apiKeyEnv}，请检查 ${expandHome(options.envFile)} 或当前环境变量`);
  }
  return value.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/env.ts __tests__/zai-usage/env.test.ts
git commit -m "feat(zai-usage): dotenv 读取 Z_API_KEY"
```

---

## Task 4: zai-usage config (YAML 加载)

**Files:**
- Create: `src/zai-usage/config.ts`
- Test: `__tests__/zai-usage/config.test.ts`

**Interfaces:**
- Consumes: `shared/notifiers/types` 的 `ChannelConfig`
- Produces: `PollConfig`（`{ poll: { interval_seconds }, alert: { windows: ZaiAlertWindow[] }, channels }`）、`ZaiAlertWindow = 'primary' | 'secondary'`、`loadPollConfig(path): Promise<PollConfig>`、`DEFAULT_CONFIG_PATH`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/config.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/config.ts`（结构对齐 `codex-usage/config.ts` 的 alert 模式 + `minimax-usage/config.ts` 的 channel 校验）:
```typescript
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ChannelConfig } from '../shared/notifiers/types';

export type ZaiAlertWindow = 'primary' | 'secondary';
const VALID_WINDOWS: readonly ZaiAlertWindow[] = ['primary', 'secondary'];

export interface PollConfig {
  poll: { interval_seconds: number };
  alert: { windows: ZaiAlertWindow[] };
  channels: ChannelConfig[];
}

const DEFAULTS: PollConfig = {
  poll: { interval_seconds: 300 },
  alert: { windows: ['primary', 'secondary'] },
  channels: [],
};

function validateChannel(raw: unknown, index: number): ChannelConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error(`channels[${index}] 不是对象`);
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'feishu') throw new Error(`未知通道类型 channels[${index}].type=${String(obj['type'])}`);
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

function validateWindows(raw: unknown): ZaiAlertWindow[] {
  if (raw === undefined) return DEFAULTS.alert.windows;
  if (!Array.isArray(raw)) throw new Error('alert.windows 必须是数组');
  return raw.map((w, i) => {
    if (typeof w !== 'string' || !VALID_WINDOWS.includes(w as ZaiAlertWindow)) {
      throw new Error(`alert.windows[${i}] 非法: ${String(w)}`);
    }
    return w as ZaiAlertWindow;
  });
}

export async function loadPollConfig(filePath: string): Promise<PollConfig> {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`配置文件不存在: ${resolved}`);
    throw error;
  }
  const parsed: unknown = YAML.parse(content) ?? {};
  if (typeof parsed !== 'object' || parsed === null) throw new Error('配置文件格式无效：不是对象');
  const obj = parsed as Record<string, unknown>;

  const pollRaw = (obj['poll'] as { interval_seconds?: unknown } | undefined) ?? {};
  const interval = typeof pollRaw.interval_seconds === 'number' && pollRaw.interval_seconds > 0
    ? pollRaw.interval_seconds
    : DEFAULTS.poll.interval_seconds;

  const alertRaw = (obj['alert'] as { windows?: unknown } | undefined) ?? {};
  const windows = validateWindows(alertRaw.windows);

  const channelsRaw = (obj['channels'] as unknown[] | undefined) ?? [];
  if (!Array.isArray(channelsRaw)) throw new Error('channels 必须是数组');
  const channels = channelsRaw.map((c, i) => validateChannel(c, i));

  return { poll: { interval_seconds: interval }, alert: { windows }, channels };
}

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/zai-usage-config.yaml');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/config.ts __tests__/zai-usage/config.test.ts
git commit -m "feat(zai-usage): YAML 配置加载与校验"
```

---

## Task 5: zai-usage format (文本格式化)

**Files:**
- Create: `src/zai-usage/format.ts`
- Test: `__tests__/zai-usage/format.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `ZaiUsageSnapshot` / `ZaiLimitWindow`
- Produces: `formatLocalTime(ms)`、`formatWindowLine(window: ZaiLimitWindow, label: string)`、`formatUsageText(snapshot, nowMs?)`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/format.test.ts`:
```typescript
import { formatLocalTime, formatWindowLine, formatUsageText } from '@/zai-usage/format';
import type { ZaiLimitWindow, ZaiUsageSnapshot } from '@/zai-usage/types';

const primary: ZaiLimitWindow = {
  type: 'TOKENS_LIMIT', windowMinutes: 300, windowLabel: '5 hours window',
  usage: 100, remaining: 80, currentValue: 20, usedPercent: 20, resetsAtMs: 1_700_000_000_000,
  usageDetails: [],
};

describe('zai-usage format', () => {
  test('formatLocalTime handles null', () => {
    expect(formatLocalTime(null)).toBe('未知');
    expect(formatLocalTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('formatWindowLine renders label / 用量 / 线性预算 / 重置', () => {
    const line = formatWindowLine(primary, '主窗口');
    expect(line).toContain('主窗口');
    expect(line).toContain('20%');
  });

  test('formatUsageText with empty snapshot', () => {
    const snapshot: ZaiUsageSnapshot = { planName: null, primary: null, secondary: null, raw: {} };
    const text = formatUsageText(snapshot, 1_700_000_000_000);
    expect(text).toContain('未返回用量数据');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/format.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/format.ts`:
```typescript
import { ZaiLimitWindow, ZaiUsageSnapshot } from './types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '未知';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function percent(value: number | null): string {
  return value === null ? '未知' : `${value.toFixed(0)}%`;
}

export function formatWindowLine(window: ZaiLimitWindow, label: string): string {
  const reset = window.resetsAtMs && window.resetsAtMs > 0 ? ` ｜重置 ${formatLocalTime(window.resetsAtMs)}` : '';
  const win = window.windowLabel ?? window.type;
  return [
    `- ${label}（${win}）`,
    `已用 ${percent(window.usedPercent)}`,
    `剩余 ${window.remaining ?? '?'}`,
    reset,
  ].join(' ｜ ');
}

export function formatUsageText(snapshot: ZaiUsageSnapshot, nowMs = Date.now()): string {
  const lines: string[] = [];
  if (snapshot.primary) lines.push(formatWindowLine(snapshot.primary, '主窗口'));
  if (snapshot.secondary) lines.push(formatWindowLine(snapshot.secondary, '次窗口'));
  const plan = snapshot.planName ? ` ｜套餐 ${snapshot.planName}` : '';
  return [
    `Z.ai 用量${plan} ｜当前时间 ${formatLocalTime(nowMs)}`,
    '',
    ...(lines.length > 0 ? lines : ['未返回用量数据']),
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/format.ts __tests__/zai-usage/format.test.ts
git commit -m "feat(zai-usage): 用量文本格式化"
```

---

## Task 6: zai-usage poll (buildPollReport + checkProrated)

**Files:**
- Create: `src/zai-usage/poll.ts`
- Test: `__tests__/zai-usage/poll.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 snapshot、`shared/alert/prorated` 的 `checkProrated`、`shared/notifiers` 的 `buildNotifiers`
- Produces: `buildPollReport(snapshot, options)`、`runOnce(options)`、`runPoll(options)`、`PollReport`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/poll.test.ts`:
```typescript
import { buildPollReport } from '@/zai-usage/poll';
import type { ZaiUsageSnapshot, ZaiLimitWindow } from '@/zai-usage/types';

function makeWindow(over: { usedPercent: number; resetsAtMs: number; windowMinutes: number }): ZaiLimitWindow {
  return {
    type: 'TOKENS_LIMIT',
    windowMinutes: over.windowMinutes,
    windowLabel: '5 hours window',
    usage: 100, remaining: null, currentValue: null,
    usedPercent: over.usedPercent,
    resetsAtMs: over.resetsAtMs,
    usageDetails: [],
  };
}

// 固定 now，窗口 5 小时(=18_000_000ms)。窗口在 now 之后 1 小时重置 → 已过 4 小时 → 线性预算 80%。
const NOW = 1_700_000_000_000;
const WINDOW_MS = 5 * 60 * 60 * 1000;
const RESETS_AT = NOW + 1 * 60 * 60 * 1000; // 还有 1h 重置 → elapsed 4h → expected 80%

function makeSnapshot(usedPercent: number): ZaiUsageSnapshot {
  return {
    planName: 'Pro',
    primary: makeWindow({ usedPercent, resetsAtMs: RESETS_AT, windowMinutes: 300 }),
    secondary: null,
    raw: {},
  };
}

describe('zai-usage poll report', () => {
  test('info when 用量低于线性预算', () => {
    // 用量 50% < 线性 80% → 不告警
    const report = buildPollReport(makeSnapshot(50), { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.title).toContain('Z.ai 用量报告');
    expect(report.content).toContain('线性预算');
    expect(report.summaryLine).toContain('alert=false');
  });

  test('warn when 用量超过线性预算', () => {
    // 用量 90% > 线性 80% → 告警
    const report = buildPollReport(makeSnapshot(90), { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('Z.ai 用量告警');
    expect(report.content).toContain('🚨');
    expect(report.summaryLine).toContain('alert=true');
  });

  test('skips window with unknown windowMinutes', () => {
    const snapshot: ZaiUsageSnapshot = {
      planName: null,
      primary: makeWindow({ usedPercent: 90, resetsAtMs: RESETS_AT, windowMinutes: null }),
      secondary: null,
      raw: {},
    };
    const report = buildPollReport(snapshot, { windows: ['primary'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.content).toContain('跳过告警判定');
  });

  test('expected uses checkProrated math (80%)', () => {
    const report = buildPollReport(makeSnapshot(50), { windows: ['primary'], nowMs: NOW });
    // 解析 content 里的 "线性预算 80%"
    expect(report.content).toMatch(/线性预算 80\.0%/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/poll.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/poll.ts`（结构对齐 `codex-usage/poll.ts`）:
```typescript
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { PollConfig, ZaiAlertWindow } from './config';
import { formatLocalTime, formatWindowLine } from './format';
import { ZaiLimitWindow, ZaiUsageSnapshot } from './types';

interface WindowMeta {
  label: string;
  get: (s: ZaiUsageSnapshot) => ZaiLimitWindow | null;
}

const WINDOWS: Record<ZaiAlertWindow, WindowMeta> = {
  primary: { label: '主窗口', get: (s) => s.primary },
  secondary: { label: '次窗口', get: (s) => s.secondary },
};

export interface ReportOptions {
  windows: ZaiAlertWindow[];
  nowMs: number;
}

export interface AlertEntry {
  window: ZaiAlertWindow;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

export function buildPollReport(snapshot: ZaiUsageSnapshot, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const key of options.windows) {
    const meta = WINDOWS[key];
    const win = meta.get(snapshot);
    if (!win) continue;

    const resetLabel = win.resetsAtMs && win.resetsAtMs > 0 ? ` ｜结束 ${formatLocalTime(win.resetsAtMs)}` : '';
    const utilization = win.usedPercent ?? 0;

    if (win.windowMinutes === null || win.windowMinutes <= 0) {
      lines.push(`  ${meta.label}：${utilization.toFixed(1)}% ｜windowMinutes 未知，跳过告警判定${resetLabel}`);
      continue;
    }

    const result = checkProrated({
      utilization,
      resetsAtMs: win.resetsAtMs ?? 0,
      windowMs: win.windowMinutes * 60_000,
      nowMs: options.nowMs,
    });
    entries.push({ window: key, label: meta.label, utilization, result });

    const prefix = result.breached ? '🚨' : '  ';
    const diffLabel = result.breached ? `超 ${result.overBy.toFixed(1)}pp` : `差 ${result.overBy.toFixed(1)}pp`;
    lines.push(`${prefix} ${meta.label}：${utilization.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}${resetLabel}`);
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 Z.ai 用量告警' : '📊 Z.ai 用量报告';
  const plan = snapshot.planName ? ` ｜**套餐**：${snapshot.planName}` : '';
  const header = `${plan} ｜**当前时间**：${formatLocalTime(options.nowMs)}`.trim();
  const content = [header, '', ...lines].join('\n').trim();

  const summaryLine =
    entries.map((e) => `${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`).join(' ') +
    ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  fetcher: () => Promise<ZaiUsageSnapshot>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

export async function runOnce(options: {
  config: PollConfig;
  fetcher: () => Promise<ZaiUsageSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot, { windows: options.config.alert.windows, nowMs: Date.now() });
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

  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({ config: options.config, fetcher: options.fetcher, notifiers, logLine, logError });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] 轮询失败: ${message}`);
    }
  };

  await tick();
  const handle = setInterval(() => {
    if (options.signal.stopped) { clearInterval(handle); return; }
    void tick();
  }, options.intervalSec * 1000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/poll.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/zai-usage/poll.ts __tests__/zai-usage/poll.test.ts
git commit -m "feat(zai-usage): 轮询与线性预算告警"
```

---

## Task 7: zai-usage index (CLI) + package.json bin

**Files:**
- Create: `src/zai-usage/index.ts`
- Modify: `package.json`
- Test: `__tests__/zai-usage/index.test.ts`

**Interfaces:**
- Consumes: Task 2/3/4/6 的 `fetchZaiUsage`/`readZaiApiKey`/`loadPollConfig`/`runPoll`/`buildPollReport`
- Produces: bin `zai-usage`、导出 `parseSeconds`、`createProgram`

- [ ] **Step 1: Write the failing test**

`__tests__/zai-usage/index.test.ts`:
```typescript
import { parseSeconds } from '@/zai-usage/index';

describe('zai-usage/index', () => {
  test('uses default seconds when flag has no explicit value', () => {
    expect(parseSeconds(true, 300)).toBe(300);
  });
  test('parses explicit seconds', () => {
    expect(parseSeconds('900', 300)).toBe(900);
  });
  test('rejects invalid seconds', () => {
    expect(() => parseSeconds('0', 300)).toThrow('interval must be a positive integer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/zai-usage/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/zai-usage/index.ts`（对齐 `minimax-usage/index.ts`）:
```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { buildNotifiers } from '../shared/notifiers';
import { DEFAULT_CONFIG_PATH, loadPollConfig } from './config';
import { DEFAULT_API_KEY_ENV, DEFAULT_ENV_FILE, readZaiApiKey } from './env';
import { formatUsageText } from './format';
import { buildPollReport, runPoll } from './poll';
import { fetchZaiUsage, DEFAULT_ZAI_HOST } from './quota';
import { ZaiUsageSnapshot } from './types';

const stopSignal = { stopped: false };

interface CliOptions {
  json?: boolean;
  notify?: boolean;
  poll?: string | true;
  config: string;
  envFile: string;
  apiKeyEnv: string;
  apiHost: string;
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
  const seconds = raw === true ? defaultSec : parseInt(raw, 10);
  if (isNaN(seconds) || seconds < 1) throw new Error('interval must be a positive integer');
  return seconds;
}

async function getSnapshot(options: CliOptions): Promise<ZaiUsageSnapshot> {
  const apiKey = await readZaiApiKey({ envFile: options.envFile, apiKeyEnv: options.apiKeyEnv });
  return fetchZaiUsage({ apiKey, apiHost: options.apiHost });
}

async function printSnapshot(options: CliOptions): Promise<void> {
  const snapshot = await getSnapshot(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return;
  }
  process.stdout.write(formatUsageText(snapshot) + '\n');
}

async function notifyOnce(options: CliOptions): Promise<void> {
  const [config, snapshot] = await Promise.all([loadPollConfig(options.config), getSnapshot(options)]);
  const report = buildPollReport(snapshot, { windows: config.alert.windows, nowMs: Date.now() });
  const notifiers = buildNotifiers(config.channels);
  const results = await Promise.allSettled(
    notifiers.map((n) => n.send({ title: report.title, content: report.content, level: report.level }))
  );
  const failed = results.map((result, index) => ({ result, index })).filter((item) => item.result.status === 'rejected');
  if (failed.length > 0) {
    const messages = failed.map((item) => {
      const reason = item.result.status === 'rejected'
        ? (item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason))
        : '';
      return `${notifiers[item.index]?.name ?? item.index}: ${reason}`;
    });
    throw new Error(`通知发送失败: ${messages.join('; ')}`);
  }
  process.stdout.write(`[${new Date().toISOString()}] ${report.summaryLine}\n`);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('zai-usage')
    .description('Display Z.ai (Zhipu) Coding Plan usage and send reports through the Feishu channel')
    .option('-p, --poll [seconds]', 'headless poll every N seconds and dispatch to channels')
    .option('--notify', 'send one usage report to configured channels')
    .option('-c, --config <path>', 'channel config path', DEFAULT_CONFIG_PATH)
    .option('--env-file <path>', 'dotenv file containing Z_API_KEY', DEFAULT_ENV_FILE)
    .option('--api-key-env <name>', 'dotenv/env key name for Z.ai API key', DEFAULT_API_KEY_ENV)
    .option('--api-host <url>', 'Z.ai API host', DEFAULT_ZAI_HOST)
    .option('--json', 'print raw normalized JSON')
    .action(async (options: CliOptions) => {
      if (options.poll !== undefined && options.notify) {
        process.stderr.write('error: --poll and --notify are mutually exclusive\n');
        process.exit(1);
      }
      if (options.poll !== undefined) {
        const config = await loadPollConfig(options.config);
        const intervalSec = options.poll === true ? config.poll.interval_seconds : parseSeconds(options.poll, 300);
        process.stdout.write(
          `[${new Date().toISOString()}] zai-usage poll started (interval=${intervalSec}s, channels=${config.channels.length})\n`
        );
        await runPoll({ intervalSec, config, signal: stopSignal, fetcher: () => getSnapshot(options) });
        return;
      }
      if (options.notify) { await notifyOnce(options); return; }
      await printSnapshot(options);
    });
  return program;
}

if (require.main === module) {
  setupSignalHandlers();
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Register bin + build check**

Modify `package.json` — 在 `bin` 对象中加入（保持字母序附近）：
```json
"zai-usage": "dist/zai-usage/index.js",
```

Run: `pnpm run build`
Expected: 编译通过，`dist/zai-usage/index.js` 生成

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- __tests__/zai-usage/index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/zai-usage/index.ts __tests__/zai-usage/index.test.ts package.json
git commit -m "feat(zai-usage): commander CLI 与 bin 注册"
```

---

## Task 8: zai-usage 配置示例 + 端到端冒烟

**Files:**
- Create: `local/zai-usage-config.example.yaml`

**Interfaces:** 无（配置文档）

- [ ] **Step 1: 创建配置示例**

`local/zai-usage-config.example.yaml`:
```yaml
# zai-usage poll config
# 由 pm2 后台进程加载（轮询），或手动 `zai-usage --notify` 单次发送
# 凭据来源：飞书应用（复用 claude-usage 同一应用）
# API Key：~/Documents/knowledge/local/.env 的 Z_API_KEY

poll:
  interval_seconds: 900   # 15 分钟

alert:
  windows: [primary, secondary]   # 参与线性预算告警判定的窗口

channels:
  - type: feishu
    app_id: "cli_xxxxx"           # 替换为你的飞书应用 app_id
    app_secret: "xxxxx"           # 替换为 app_secret
    receive_id: "oc_xxxxx"        # 替换为目标会话 chat_id
    receive_id_type: chat_id
```

- [ ] **Step 2: 端到端冒烟（手动，需真实 Z_API_KEY）**

Run: `pnpm run build && node dist/zai-usage/index.js --json`
Expected: 打印归一化 JSON，含 `planName` / `primary` / `secondary`

若 key 有效，再测通知（需先填好 `local/zai-usage-config.yaml`）：
Run: `node dist/zai-usage/index.js --notify`
Expected: 控制台输出 `summaryLine`，飞书群收到卡片

> 若无法联网或 key 无效，跳过冒烟，仅依赖单元测试。

- [ ] **Step 3: Commit**

```bash
git add local/zai-usage-config.example.yaml
git commit -m "docs(zai-usage): 配置示例"
```

---

## Task 9: minimax-usage HTTP 重构 — quota.ts

**Files:**
- Modify: `src/minimax-usage/quota.ts`（重写）
- Modify: `src/minimax-usage/types.ts`（snapshot 加 `planName`、`pointsBalance`）
- Test: `__tests__/minimax-usage/quota.test.ts`（重写）

**Interfaces:**
- Consumes: `MiniMaxQuotaSnapshot`（types.ts，新增 `planName`）
- Produces: `fetchMiniMaxQuota({ apiKey, apiHost?, fetchImpl? })`（签名变化：移除 command/commandArgs，加 apiHost/fetchImpl）、`normalizeQuota` / `extractJsonPayload`（保留但调整解包逻辑）、`DEFAULT_MINIMAX_HOST`

- [ ] **Step 1: Write the failing test**

`__tests__/minimax-usage/quota.test.ts`（重写；真实响应样例对齐 CodexBar `MiniMaxProviderTests.swift` 的 `model_remains` 结构）:
```typescript
import { extractJsonPayload, normalizeQuota, DEFAULT_MINIMAX_HOST } from '@/minimax-usage/quota';

describe('minimax-usage quota normalize', () => {
  test('extracts model_remains from wrapped data envelope', () => {
    const raw = extractJsonPayload(`{"base_resp":{"status_code":0},"data":{"model_remains":[],"plan_name":"Plus"}}`);
    expect(raw.data?.model_remains).toEqual([]);
    expect(raw.data?.plan_name).toBe('Plus');
  });

  test('normalizes model remains', () => {
    const snapshot = normalizeQuota({
      base_resp: { status_code: 0 },
      data: {
        plan_name: 'Plus',
        model_remains: [
          {
            model_name: 'general',
            current_interval_remaining_percent: 97,
            current_weekly_remaining_percent: 100,
            end_time: 1781265600000,
            start_time: 1781265600000 - 5 * 60 * 60 * 1000,
            weekly_end_time: 1781452800000,
            weekly_start_time: 1781452800000 - 7 * 24 * 60 * 60 * 1000,
          },
        ],
      },
    });
    expect(snapshot.planName).toBe('Plus');
    expect(snapshot.models[0]?.modelName).toBe('general');
    expect(snapshot.models[0]?.interval.usedPercent).toBe(3);
    expect(snapshot.models[0]?.weekly.usedPercent).toBe(0);
  });

  test('throws when base_resp status_code !== 0', () => {
    expect(() => normalizeQuota({ base_resp: { status_code: 1004, status_msg: 'login required' }, data: { model_remains: [] } }))
      .toThrow(/login required|凭据/);
  });

  test('throws when model_remains empty', () => {
    expect(() => normalizeQuota({ base_resp: { status_code: 0 }, data: { model_remains: [] } }))
      .toThrow(/Missing|未返回/);
  });
});

describe('minimax-usage default host', () => {
  test('is china mainland api host', () => {
    expect(DEFAULT_MINIMAX_HOST).toBe('https://api.minimaxi.com');
  });
});
```

> 注：`normalizeQuota` 的输入类型签名需放宽为接受 `{ data?: { model_remains?: unknown }, base_resp?: ... }`；现有实现读 `raw.model_remains`，改为读 `raw.data?.model_remains ?? raw.model_remains`（兼容旧 mmx 顶层输出）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/minimax-usage/quota.test.ts`
Expected: FAIL（DEFAULT_MINIMAX_HOST 不存在 / normalizeQuota 不解包 data / planName 缺失）

- [ ] **Step 3: Update types.ts — snapshot 加 planName**

`src/minimax-usage/types.ts`，在 `MiniMaxQuotaSnapshot` 接口加字段：
```typescript
export interface MiniMaxQuotaSnapshot {
  models: MiniMaxModelQuota[];
  planName: string | null;
  raw: MiniMaxRawQuota;
}
```
同时在 `MiniMaxRawQuota` 加可选 `data?: { model_remains?: unknown; plan_name?: unknown; points_balance?: unknown; [k: string]: unknown } | null`。

- [ ] **Step 4: Rewrite quota.ts**

`src/minimax-usage/quota.ts`（完整重写，移除 spawn）:
```typescript
import {
  MiniMaxModelQuota,
  MiniMaxQuotaSnapshot,
  MiniMaxQuotaWindow,
  MiniMaxRawModelRemain,
  MiniMaxRawQuota,
} from './types';

export const DEFAULT_MINIMAX_HOST = 'https://api.minimaxi.com';
const TOKEN_PLAN_PATH = 'v1/token_plan/remains';
const CODING_PLAN_PATH = 'v1/api/openplatform/coding_plan/remains';

export interface FetchQuotaOptions {
  apiKey: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function percentUsed(remainingPercent: number | null): number | null {
  if (remainingPercent === null) return null;
  return Math.max(0, Math.min(100, 100 - remainingPercent));
}

function buildWindow(options: {
  startMs: unknown; endMs: unknown; remainsMs: unknown;
  totalCount: unknown; usageCount: unknown; remainingPercent: unknown; status: unknown;
}): MiniMaxQuotaWindow {
  const remainingPercent = asNumber(options.remainingPercent);
  return {
    startMs: asNumber(options.startMs),
    endMs: asNumber(options.endMs),
    remainsMs: asNumber(options.remainsMs),
    totalCount: asNumber(options.totalCount),
    usageCount: asNumber(options.usageCount),
    remainingPercent,
    usedPercent: percentUsed(remainingPercent),
    status: asNumber(options.status),
  };
}

function normalizeModel(raw: MiniMaxRawModelRemain): MiniMaxModelQuota {
  const modelName = typeof raw.model_name === 'string' && raw.model_name.length > 0 ? raw.model_name : 'unknown';
  return {
    modelName,
    interval: buildWindow({
      startMs: raw.start_time, endMs: raw.end_time, remainsMs: raw.remains_time,
      totalCount: raw.current_interval_total_count, usageCount: raw.current_interval_usage_count,
      remainingPercent: raw.current_interval_remaining_percent, status: raw.current_interval_status,
    }),
    weekly: buildWindow({
      startMs: raw.weekly_start_time, endMs: raw.weekly_end_time, remainsMs: raw.weekly_remains_time,
      totalCount: raw.current_weekly_total_count, usageCount: raw.current_weekly_usage_count,
      remainingPercent: raw.current_weekly_remaining_percent, status: raw.current_weekly_status,
    }),
  };
}

/** 兼容两种包装：HTTP 的 { data: { model_remains } } 与旧 mmx 的顶层 model_remains */
export function extractJsonPayload(output: string): MiniMaxRawQuota {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('minimax 响应未返回 JSON');
  return JSON.parse(output.slice(start, end + 1)) as MiniMaxRawQuota;
}

export function normalizeQuota(raw: MiniMaxRawQuota): MiniMaxQuotaSnapshot {
  const dataEnvelope = (raw as { data?: { model_remains?: unknown; plan_name?: unknown } | null }).data;
  const remainsSource = Array.isArray((dataEnvelope as { model_remains?: unknown } | null)?.model_remains)
    ? ((dataEnvelope as { model_remains: unknown[] }).model_remains)
    : Array.isArray((raw as { model_remains?: unknown }).model_remains)
      ? (raw as { model_remains: unknown[] }).model_remains
      : [];

  // base_resp 状态校验（HTTP 包装在顶层或 data 内）
  const baseResp = (raw as { base_resp?: { status_code?: unknown; status_msg?: unknown } }).base_resp
    ?? (dataEnvelope as { base_resp?: { status_code?: unknown; status_msg?: unknown } } | null)?.base_resp;
  const statusCode = asNumber(baseResp?.status_code);
  if (statusCode !== null && statusCode !== 0) {
    const msg = typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : `status_code ${statusCode}`;
    const lower = msg.toLowerCase();
    if (statusCode === 1004 || lower.includes('cookie') || lower.includes('log in') || lower.includes('login')) {
      throw new Error(`minimax 凭据无效: ${msg}`);
    }
    throw new Error(`minimax 用量查询失败: ${msg}`);
  }

  if (remainsSource.length === 0) throw new Error('minimax 未返回 model_remains 数据');

  const models = remainsSource.map((item) => normalizeModel(item as MiniMaxRawModelRemain));
  const planName = typeof (dataEnvelope as { plan_name?: unknown } | null)?.plan_name === 'string'
    ? ((dataEnvelope as { plan_name: string }).plan_name).trim() || null
    : null;

  return { models, planName, raw };
}

interface HttpResponse { ok: boolean; status: number; text(): Promise<string>; }

async function fetchOnce(
  doFetch: typeof fetch,
  url: string,
  apiKey: string
): Promise<MiniMaxQuotaSnapshot> {
  const response = (await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  })) as HttpResponse;
  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(`minimax 凭据无效 (HTTP ${response.status})`);
    throw new Error(`minimax 用量查询失败 (HTTP ${response.status}): ${body || 'unknown error'}`);
  }
  return normalizeQuota(extractJsonPayload(body));
}

/** 是否应 fallback 到旧端点（照搬 CodexBar shouldTryLegacyAPIEndpoint） */
function shouldTryLegacy(after: Error): boolean {
  const msg = after.message.toLowerCase();
  if (msg.includes('凭据')) return false;
  return msg.includes('http 404') || msg.includes('http 405') || msg.includes('未返回');
}

export async function fetchMiniMaxQuota(options: FetchQuotaOptions): Promise<MiniMaxQuotaSnapshot> {
  const doFetch = options.fetchImpl ?? fetch;
  const host = (options.apiHost ?? DEFAULT_MINIMAX_HOST).replace(/\/+$/, '');
  try {
    return await fetchOnce(doFetch, `${host}/${TOKEN_PLAN_PATH}`, options.apiKey);
  } catch (error) {
    if (!(error instanceof Error) || !shouldTryLegacy(error)) throw error;
    return await fetchOnce(doFetch, `${host}/${CODING_PLAN_PATH}`, options.apiKey);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- __tests__/minimax-usage/quota.test.ts`
Expected: PASS

> 若其他测试（poll/config）因 `MiniMaxQuotaSnapshot` 缺 `planName` 编译失败，先在本 task 修复编译（下一个 task 会改 poll）。

- [ ] **Step 6: Commit**

```bash
git add src/minimax-usage/quota.ts src/minimax-usage/types.ts __tests__/minimax-usage/quota.test.ts
git commit -m "refactor(minimax-usage): 移除 mmx-cli，改纯 HTTP 查询"
```

---

## Task 10: minimax-usage 告警接入 checkProrated

**Files:**
- Modify: `src/minimax-usage/poll.ts`
- Modify: `src/minimax-usage/config.ts`（加 `alert.windows`）
- Modify: `src/minimax-usage/format.ts`（报告行格式）
- Test: `__tests__/minimax-usage/poll.test.ts`、`__tests__/minimax-usage/config.test.ts`

**Interfaces:**
- Consumes: `shared/alert/prorated` 的 `checkProrated`
- Produces: `buildPollReport(snapshot, options: { windows, nowMs })`（签名变化：第二个参数从 `nowMs: number` 变为 options 对象）、`MiniMaxAlertWindow = 'interval' | 'weekly'`

- [ ] **Step 1: Write the failing test**

`__tests__/minimax-usage/poll.test.ts`（重写；窗口长度由 start/end 推导）:
```typescript
import { buildPollReport } from '@/minimax-usage/poll';
import type { MiniMaxQuotaSnapshot } from '@/minimax-usage/types';

const NOW = 1_700_000_000_000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;
// 窗口还剩 1h 重置 → 已过 4h → 线性预算 80%
const END = NOW + 1 * 60 * 60 * 1000;
const START = END - FIVE_HOURS;

function makeSnapshot(remainingPercent: number): MiniMaxQuotaSnapshot {
  return {
    planName: 'Plus',
    raw: {},
    models: [{
      modelName: 'general',
      interval: {
        startMs: START, endMs: END, remainsMs: FIVE_HOURS,
        totalCount: 100, usageCount: 0,
        remainingPercent, usedPercent: 100 - remainingPercent, status: 1,
      },
      weekly: { startMs: START, endMs: END, remainsMs: FIVE_HOURS, totalCount: 100, usageCount: 0, remainingPercent: 100, usedPercent: 0, status: 3 },
    }],
  };
}

describe('minimax-usage poll report', () => {
  test('info when below linear budget', () => {
    // remaining 50 → used 50% < 线性 80%
    const report = buildPollReport(makeSnapshot(50), { windows: ['interval'], nowMs: NOW });
    expect(report.level).toBe('info');
    expect(report.content).toMatch(/线性预算 80\.0%/);
  });

  test('warn when above linear budget', () => {
    // remaining 5 → used 95% > 线性 80%
    const report = buildPollReport(makeSnapshot(5), { windows: ['interval'], nowMs: NOW });
    expect(report.level).toBe('warn');
    expect(report.title).toContain('告警');
    expect(report.summaryLine).toContain('alert=true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/minimax-usage/poll.test.ts`
Expected: FAIL（签名/逻辑不匹配）

- [ ] **Step 3: Update config.ts — add alert.windows**

`src/minimax-usage/config.ts`：加 `MiniMaxAlertWindow` 类型与 `alert: { windows }`，照搬 `codex-usage/config.ts` 的 `validateWindows` 模式（VALID_WINDOWS = `['interval', 'weekly']`，默认两者都开），`PollConfig` 增加 `alert` 字段。

同步更新 `__tests__/minimax-usage/config.test.ts`：加 `alert.windows` 默认值断言（`['interval', 'weekly']`）。

- [ ] **Step 4: Rewrite poll.ts — checkProrated**

`src/minimax-usage/poll.ts`（结构对齐 zai-usage/poll.ts）:
```typescript
import { buildNotifiers } from '../shared/notifiers';
import { NotifierMessage } from '../shared/notifiers/types';
import { checkProrated, ProratedResult } from '../shared/alert/prorated';
import { MiniMaxAlertWindow, PollConfig } from './config';
import { formatLocalTime } from './format';
import { MiniMaxModelQuota, MiniMaxQuotaSnapshot } from './types';

interface WindowMeta {
  label: string;
  get: (m: MiniMaxModelQuota) => MiniMaxQuotaSnapshot['models'][number]['interval'];
}

const WINDOWS: Record<MiniMaxAlertWindow, WindowMeta> = {
  interval: { label: '5小时', get: (m) => m.interval },
  weekly: { label: '周', get: (m) => m.weekly },
};

function formatLocalTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '未知';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface ReportOptions {
  windows: MiniMaxAlertWindow[];
  nowMs: number;
}

export interface AlertEntry {
  window: MiniMaxAlertWindow;
  model: string;
  label: string;
  utilization: number;
  result: ProratedResult;
}

export interface PollReport extends NotifierMessage {
  alerts: AlertEntry[];
  summaryLine: string;
}

export function buildPollReport(snapshot: MiniMaxQuotaSnapshot, options: ReportOptions): PollReport {
  const entries: AlertEntry[] = [];
  const lines: string[] = [];

  for (const model of snapshot.models) {
    for (const key of options.windows) {
      const meta = WINDOWS[key];
      const win = meta.get(model);
      const resetLabel = win.endMs && win.endMs > 0 ? ` ｜结束 ${formatLocalTime(win.endMs)}` : '';
      const utilization = win.usedPercent ?? 0;
      const windowMs = win.endMs !== null && win.startMs !== null ? win.endMs - win.startMs : null;

      if (windowMs === null || windowMs <= 0) {
        lines.push(`  ${model.modelName} ${meta.label}：${utilization.toFixed(1)}% ｜窗口时长未知，跳过告警判定${resetLabel}`);
        continue;
      }
      const result = checkProrated({ utilization, resetsAtMs: win.endMs ?? 0, windowMs, nowMs: options.nowMs });
      entries.push({ window: key, model: model.modelName, label: meta.label, utilization, result });
      const prefix = result.breached ? '🚨' : '  ';
      const diffLabel = result.breached ? `超 ${result.overBy.toFixed(1)}pp` : `差 ${result.overBy.toFixed(1)}pp`;
      lines.push(`${prefix} ${model.modelName} ${meta.label}：${utilization.toFixed(1)}% ｜线性预算 ${result.expected.toFixed(1)}% ｜${diffLabel}${resetLabel}`);
    }
  }

  const alerts = entries.filter((e) => e.result.breached);
  const level: 'info' | 'warn' = alerts.length > 0 ? 'warn' : 'info';
  const title = level === 'warn' ? '🚨 MiniMax 用量告警' : '📊 MiniMax 用量报告';
  const plan = snapshot.planName ? ` ｜**套餐**：${snapshot.planName}` : '';
  const header = `${plan} ｜**当前时间**：${formatLocalTime(options.nowMs)}`.trim();
  const content = [header, '', ...(lines.length > 0 ? lines : ['未返回模型用量数据'])].join('\n');

  const summaryLine =
    entries.map((e) => `${e.model}.${e.window}=${e.utilization.toFixed(1)}%(exp${e.result.expected.toFixed(1)}%)`).join(' ') +
    ` alert=${alerts.length > 0}`;

  return { title, content, level, alerts, summaryLine };
}

export interface RunPollOptions {
  intervalSec: number;
  config: PollConfig;
  signal: { stopped: boolean };
  fetcher: () => Promise<MiniMaxQuotaSnapshot>;
  notifiersOverride?: ReturnType<typeof buildNotifiers>;
  logLine?: (line: string) => void;
  logError?: (line: string) => void;
}

export async function runOnce(options: {
  config: PollConfig;
  fetcher: () => Promise<MiniMaxQuotaSnapshot>;
  notifiers: ReturnType<typeof buildNotifiers>;
  logLine: (line: string) => void;
  logError: (line: string) => void;
}): Promise<void> {
  const snapshot = await options.fetcher();
  const report = buildPollReport(snapshot, { windows: options.config.alert.windows, nowMs: Date.now() });
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
  const tick = async (): Promise<void> => {
    if (options.signal.stopped) return;
    try {
      await runOnce({ config: options.config, fetcher: options.fetcher, notifiers, logLine, logError });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[${new Date().toISOString()}] 轮询失败: ${message}`);
    }
  };
  await tick();
  const handle = setInterval(() => {
    if (options.signal.stopped) { clearInterval(handle); return; }
    void tick();
  }, options.intervalSec * 1000);
}
```

- [ ] **Step 5: Update index.ts — pass alert.windows + --api-host**

`src/minimax-usage/index.ts`：
- `buildPollReport` 调用改为传 `{ windows: config.alert.windows, nowMs: Date.now() }`（`notifyOnce` 与 `poll.ts` 内均已用 options，index 的 `notifyOnce` 需同步）。
- `getSnapshot` 的 `fetchMiniMaxQuota({ apiKey })` 改为 `fetchMiniMaxQuota({ apiKey, apiHost: options.apiHost })`。
- 新增 `--api-host <url>` option（默认 `DEFAULT_MINIMAX_HOST`），`import { fetchMiniMaxQuota, DEFAULT_MINIMAX_HOST } from './quota'`。
- `CliOptions` 加 `apiHost: string`。

- [ ] **Step 6: Run all minimax tests + build**

Run: `pnpm test -- __tests__/minimax-usage/`
Expected: PASS

Run: `pnpm run build`
Expected: 编译通过

- [ ] **Step 7: Commit**

```bash
git add src/minimax-usage/poll.ts src/minimax-usage/config.ts src/minimax-usage/format.ts src/minimax-usage/index.ts __tests__/minimax-usage/
git commit -m "feat(minimax-usage): 告警接入 checkProrated 线性预算"
```

---

## Task 11: 全量回归 + 文档

**Files:**
- Verify: 全部测试、构建、bin 可执行

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS（auto-cmd / claude-usage / codex-usage / minimax-usage / zai-usage / shared / ...）

- [ ] **Step 2: 全量构建**

Run: `pnpm run build`
Expected: 无编译错误

- [ ] **Step 3: 验证 bin 可执行（帮助信息）**

Run: `node dist/zai-usage/index.js --help && node dist/minimax-usage/index.js --help`
Expected: 两者均打印 commander 帮助，zai-usage 含 `--api-host`，minimax-usage 含 `--api-host`

- [ ] **Step 4: 更新 CLAUDE.md（可选）**

若 CLAUDE.md 的 Tools 表需补充 `zai-usage`，在表格中加入一行（与 minimax-usage 并列）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: zai-usage + minimax HTTP 重构 全量回归通过"
```

---

## Self-Review 结果

**1. Spec 覆盖：**
- 新增 zai-usage（查询 + 飞书）→ Task 1-8 ✅
- minimax HTTP 重构（移除 mmx-cli）→ Task 9 ✅
- 告警统一 checkProrated（minimax + zai）→ Task 6（zai）+ Task 10（minimax）✅
- 端点 fallback（token_plan → coding_plan）→ Task 9 `fetchMiniMaxQuota` ✅
- 国内 host / Z_API_KEY / 国际 host → Global Constraints + 各 task ✅
- 配置示例 → Task 8 ✅
- 全量回归 → Task 11 ✅

**2. 占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码 ✅

**3. 类型一致性：**
- `ZaiUsageSnapshot.{planName, primary, secondary, raw}` — Task 1 定义，Task 2/5/6 使用，一致 ✅
- `fetchZaiUsage({ apiKey, apiHost?, fetchImpl? })` — Task 2 定义，Task 7 使用，一致 ✅
- `buildPollReport(snapshot, { windows, nowMs })` — zai(Task 6) 与 minimax(Task 10) 同签名 ✅
- `fetchMiniMaxQuota({ apiKey, apiHost?, fetchImpl? })` — Task 9 定义，Task 10 使用 ✅
- `MiniMaxQuotaSnapshot` 加 `planName` — Task 9 改 types，Task 10 poll.ts 读 `snapshot.planName`，poll.test.ts makeSnapshot 提供该字段 ✅
- `DEFAULT_MINIMAX_HOST` / `DEFAULT_ZAI_HOST` 命名一致 ✅
- `MiniMaxAlertWindow` / `ZaiAlertWindow` 各自定义于各自 config.ts ✅

**4. 已知需实现者注意点（非阻塞）：**
- Task 3 env 测试第 4 个用例若 CI 设了 `Z_API_KEY` 会干扰，实现者可在测试内 `delete process.env.Z_API_KEY`。
- Task 9/10 修改了 `MiniMaxQuotaSnapshot` 结构与 `buildPollReport` 签名，可能影响 `index.ts` 现有调用——Task 10 Step 5 已覆盖 index.ts 同步改造。
- Task 10 `format.ts` 改动较小（保留 `formatLocalTime` 等导出），若 poll.ts 自带 `formatLocalTime` 会与 format.ts 重复——实现者择一（plan 中 poll.ts 自带以减少耦合，format.ts 保留供 index 用）。
