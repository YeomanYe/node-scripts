// zai-watch 探活核心:纯函数状态匹配 + 可注入 fetch 的 checkOnce。
// 这里刻意不碰真实网络(fetch 通过参数注入),便于单测。

/** 状态匹配器:给定最终 HTTP 状态码,返回是否命中成功条件。 */
export type StatusMatcher = (status: number) => boolean;

/**
 * 解析状态规格字符串为匹配器。
 * 支持逗号分隔的单值与闭区间,例如 "200,301-399"、"200-399"。
 * 空白会被忽略;非法片段会抛错(便于在启动时尽早发现配置问题)。
 */
export function parseStatusSpec(spec: string): StatusMatcher {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`successStatus 规格为空: "${spec}"`);
  }

  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (lo > hi) {
        throw new Error(`successStatus 区间下界大于上界: "${part}"`);
      }
      ranges.push([lo, hi]);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const v = Number(part);
      ranges.push([v, v]);
      continue;
    }
    throw new Error(`successStatus 含非法片段: "${part}"`);
  }

  return (status: number): boolean => ranges.some(([lo, hi]) => status >= lo && status <= hi);
}

/** 便捷判定:状态码是否命中规格(每次都解析,适合一次性场景/测试)。 */
export function statusMatches(status: number, spec: string): boolean {
  return parseStatusSpec(spec)(status);
}

/**
 * 纯函数:把字符串里的 `${VAR}` 替换为 env.VAR(未设置 → 空字符串)。
 * 支持一个字符串里多个 `${}`;无 `${}` 时原样返回(no-op)。
 * 仅接受 [A-Za-z_][A-Za-z0-9_]* 形式的变量名。
 */
export function interpolateEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => env[name] ?? '');
}

// ───────────────────────── 模型列表解析 / 最新旗舰挑选 ─────────────────────────

/** 默认的「旗舰」正则:纯版本号 id(如 glm-4.6 / glm-5 / glm-5.2),不含 -air/-turbo/letters 后缀。 */
export const DEFAULT_FLAGSHIP_PATTERN = '^glm-\\d+(\\.\\d+)*$';

/** 默认 models 列表端点(当无法从 probe url 推导时)。 */
export const DEFAULT_MODELS_URL = 'https://api.z.ai/api/anthropic/v1/models';

/** 兼容两种返回形态的单条模型记录。 */
interface RawModelEntry {
  id?: unknown;
  /** Anthropic 形态:ISO 字符串。 */
  created_at?: unknown;
  /** OpenAI-compat 形态:epoch 秒。 */
  created?: unknown;
}

/** models 列表返回体(两种形态共用 data 数组)。 */
interface ModelsJson {
  data?: RawModelEntry[];
}

/** 规整后的模型:id + 归一化时间戳(ms)。 */
interface NormalizedModel {
  id: string;
  ts: number;
}

/** 把单条记录归一化为 { id, ts(ms) };无法识别 id 或时间 → null。 */
function normalizeModelEntry(entry: RawModelEntry): NormalizedModel | null {
  if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
  let ts = NaN;
  if (typeof entry.created_at === 'string') {
    ts = Date.parse(entry.created_at);
  } else if (typeof entry.created === 'number' && Number.isFinite(entry.created)) {
    ts = entry.created * 1000;
  }
  if (!Number.isFinite(ts)) ts = 0;
  return { id: entry.id, ts };
}

/**
 * 纯函数:从 models 列表返回体中挑出「最新旗舰」模型 id。
 * - 兼容 data[].{id, created_at}(ISO 字符串)与 data[].{id, created}(epoch 秒)。
 * - 先按 flagshipPattern 过滤,取 ts 最大者;若无任何旗舰匹配,则在全部模型里取 ts 最大者兜底。
 * - 列表为空 → 返回 null。
 */
export function pickLatestFlagshipModel(
  modelsJson: ModelsJson | null | undefined,
  opts: { flagshipPattern?: string } = {},
): string | null {
  const data = modelsJson?.data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const normalized: NormalizedModel[] = [];
  for (const entry of data) {
    const n = normalizeModelEntry(entry);
    if (n) normalized.push(n);
  }
  if (normalized.length === 0) return null;

  const pattern = opts.flagshipPattern ?? DEFAULT_FLAGSHIP_PATTERN;
  const re = new RegExp(pattern);

  const maxBy = (list: NormalizedModel[]): string | null => {
    let best: NormalizedModel | null = null;
    for (const m of list) {
      if (best === null || m.ts > best.ts) best = m;
    }
    return best ? best.id : null;
  };

  const flagship = normalized.filter((m) => re.test(m.id));
  if (flagship.length > 0) return maxBy(flagship);
  // 无旗舰匹配 → 全量 ts 最大者兜底。
  return maxBy(normalized);
}

/** 从 probe url 推导 models 端点:末尾 /messages → /models;否则用默认端点。 */
export function deriveModelsUrl(probeUrl: string): string {
  if (/\/messages$/.test(probeUrl)) return probeUrl.replace(/\/messages$/, '/models');
  return DEFAULT_MODELS_URL;
}

export interface ResolveLatestModelOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  flagshipPattern?: string;
  fetchImpl?: typeof fetch;
}

export interface ResolveLatestModelResult {
  model: string | null;
  error?: string;
}

/**
 * 联网解析最新旗舰模型:GET modelsUrl(带同款鉴权 headers),解析 JSON,挑最新旗舰。
 * GET 失败(网络/非 2xx/解析失败)→ { model:null, error:"models list unavailable: …" }。
 * 列表为空/无可用 → { model:null }(由上层判为 "no model found")。绝不抛出。
 */
export async function resolveLatestModel(
  modelsUrl: string,
  opts: ResolveLatestModelOptions,
): Promise<ResolveLatestModelResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const init: RequestInit = { method: 'GET', redirect: 'follow', signal: controller.signal };
    if (opts.headers) init.headers = opts.headers;
    const res = await fetchImpl(modelsUrl, init);
    if (res.status < 200 || res.status >= 300) {
      return { model: null, error: `models list unavailable: HTTP ${res.status}` };
    }
    let json: ModelsJson;
    try {
      json = (await res.json()) as ModelsJson;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { model: null, error: `models list unavailable: 解析失败 (${msg})` };
    }
    const model = pickLatestFlagshipModel(json, { flagshipPattern: opts.flagshipPattern });
    return { model };
  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    const msg = isAbort ? `超时(${opts.timeoutMs}ms)` : err instanceof Error ? err.message : String(err);
    return { model: null, error: `models list unavailable: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 纯函数:把 body(JSON 字符串)里的 .model 覆写为 resolvedModel 后重新序列化。
 * body 解析失败或非对象 → 退化为 {"model": resolvedModel}(确保请求带上目标模型)。
 */
export function injectModelIntoBody(body: string | undefined, resolvedModel: string): string {
  let parsed: unknown;
  try {
    parsed = body !== undefined ? JSON.parse(body) : {};
  } catch {
    parsed = {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    parsed = {};
  }
  (parsed as Record<string, unknown>).model = resolvedModel;
  return JSON.stringify(parsed);
}

export interface CheckOptions {
  timeoutMs: number;
  successStatus: string;
  mustInclude?: string;
  mustNotInclude?: string;
  /** HTTP 方法,默认 GET。 */
  method?: string;
  /** 请求头。 */
  headers?: Record<string, string>;
  /** 请求体(字符串)。对象请在配置解析阶段 JSON.stringify 后传入。 */
  body?: string;
  /** 可注入的 fetch 实现,默认用全局 fetch;测试时注入 mock。 */
  fetchImpl?: typeof fetch;
}

export interface CheckResult {
  ok: boolean;
  status: number | null;
  timeMs: number;
  error?: string;
}

/**
 * 单次探活。ok = 无网络错误 且 最终状态命中 successStatus 且 满足 mustInclude/mustNotInclude。
 * 使用 redirect: 'follow',因此 status 是跟随跳转后的最终状态。
 * 网络错误/超时 → { ok:false, status:null, error }。绝不抛出。
 */
export async function checkOnce(url: string, opts: CheckOptions): Promise<CheckResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const matcher = parseStatusSpec(opts.successStatus);
  const needBody = Boolean(opts.mustInclude) || Boolean(opts.mustNotInclude);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = Date.now();

  try {
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      redirect: 'follow',
      signal: controller.signal,
    };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body !== undefined) init.body = opts.body;
    const res = await fetchImpl(url, init);
    const status = res.status;
    let body = '';
    if (needBody) {
      body = await res.text();
    }
    const timeMs = Date.now() - started;

    if (!matcher(status)) {
      return { ok: false, status, timeMs, error: `状态 ${status} 不在 successStatus(${opts.successStatus})` };
    }
    if (opts.mustInclude && !body.includes(opts.mustInclude)) {
      return { ok: false, status, timeMs, error: `响应体缺少 mustInclude("${opts.mustInclude}")` };
    }
    if (opts.mustNotInclude && body.includes(opts.mustNotInclude)) {
      return { ok: false, status, timeMs, error: `响应体含 mustNotInclude("${opts.mustNotInclude}")` };
    }
    return { ok: true, status, timeMs };
  } catch (err) {
    const timeMs = Date.now() - started;
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    const msg = isAbort ? `超时(${opts.timeoutMs}ms)` : err instanceof Error ? err.message : String(err);
    return { ok: false, status: null, timeMs, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
