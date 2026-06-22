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

export interface CheckOptions {
  timeoutMs: number;
  successStatus: string;
  mustInclude?: string;
  mustNotInclude?: string;
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
    const res = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
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
