#!/usr/bin/env node

// zai-watch: 轮询某个目标(默认 z.ai)是否恢复访问;连续 N 次 OK 即判定"可访问",
// 通过 cc-connect 把结果汇报到飞书(claude 频道),然后 exit(0)。
// 这是一次性「恢复后通知我」的守护:探测失败不会让进程退出,只有成功或收到信号才退。
//
// 使用:
//   zai-watch                                   # 用默认值轮询 https://z.ai
//   zai-watch --config ./local/zai-watch-config.yaml
//   zai-watch --url https://z.ai --consecutive 2 --interval 60
//   zai-watch --url https://z.ai --consecutive 1 --interval 5 --max-checks 1
//
// pm2 触发模式:autorestart:false 一次性,跑到成功即退。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import { checkOnce, interpolateEnv } from './check';

interface ZaiWatchConfig {
  url: string;
  intervalSec: number;
  timeoutSec: number;
  successStatus: string;
  consecutive: number;
  mustInclude?: string;
  mustNotInclude?: string;
  /** HTTP 方法,默认 GET(本场景为 POST)。 */
  method: string;
  /** 请求头(已做 ${ENV} 插值)。 */
  headers?: Record<string, string>;
  /** 请求体(字符串,已做 ${ENV} 插值;对象会在解析阶段 JSON.stringify)。 */
  body?: string;
  project: string;
  label?: string;
  maxChecks?: number;
}

const DEFAULTS: ZaiWatchConfig = {
  url: 'https://z.ai',
  intervalSec: 60,
  timeoutSec: 10,
  successStatus: '200-399',
  consecutive: 2,
  method: 'GET',
  project: 'default',
};

function nowIso(): string {
  return new Date().toISOString();
}

function fmtLocalTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function logOut(msg: string): void {
  process.stdout.write(`[${nowIso()}] ${msg}\n`);
}

function logErr(msg: string): void {
  process.stderr.write(`[${nowIso()}] ${msg}\n`);
}

// ───────────────────────── 配置加载(YAML/JSON 文件 + CLI 覆盖) ─────────────────────────

/** normalizeRaw 的中间产物:Partial 配置 + body 是否来自对象的标记。 */
type RawConfig = Partial<ZaiWatchConfig> & { _bodyWasObject?: boolean };

/** 把任意来源的原始配置对象规整成 RawConfig(同时兼容 snake_case)。 */
function normalizeRaw(raw: Record<string, unknown>): RawConfig {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    }
    return undefined;
  };
  const num = (v: unknown): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown): string | undefined => (v === undefined ? undefined : String(v));

  const out: RawConfig = {};
  const url = str(pick('url'));
  if (url !== undefined) out.url = url;
  const intervalSec = num(pick('intervalSec', 'interval_sec', 'interval'));
  if (intervalSec !== undefined) out.intervalSec = intervalSec;
  const timeoutSec = num(pick('timeoutSec', 'timeout_sec', 'timeout'));
  if (timeoutSec !== undefined) out.timeoutSec = timeoutSec;
  const successStatus = str(pick('successStatus', 'success_status'));
  if (successStatus !== undefined) out.successStatus = successStatus;
  const consecutive = num(pick('consecutive'));
  if (consecutive !== undefined) out.consecutive = consecutive;
  const mustInclude = str(pick('mustInclude', 'must_include'));
  if (mustInclude !== undefined) out.mustInclude = mustInclude;
  const mustNotInclude = str(pick('mustNotInclude', 'must_not_include'));
  if (mustNotInclude !== undefined) out.mustNotInclude = mustNotInclude;
  const method = str(pick('method'));
  if (method !== undefined) out.method = method.toUpperCase();
  const headersRaw = pick('headers');
  if (headersRaw && typeof headersRaw === 'object' && !Array.isArray(headersRaw)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(headersRaw as Record<string, unknown>)) {
      headers[k] = String(v);
    }
    out.headers = headers;
  }
  const bodyRaw = pick('body');
  if (bodyRaw !== undefined && bodyRaw !== null) {
    // body 可为字符串或对象;对象 → JSON.stringify 并标记,以便缺省时补 content-type。
    out.body = typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw);
    out._bodyWasObject = typeof bodyRaw !== 'string';
  }
  const project = str(pick('project'));
  if (project !== undefined) out.project = project;
  const label = str(pick('label'));
  if (label !== undefined) out.label = label;
  const maxChecks = num(pick('maxChecks', 'max_checks'));
  if (maxChecks !== undefined) out.maxChecks = maxChecks;
  return out;
}

/** 从文件加载配置(支持 YAML 与 JSON,按内容解析)。文件不存在 → 返回 {}。 */
function loadConfigFile(configPath: string): RawConfig {
  const resolved = path.resolve(configPath.replace(/^~/, os.homedir()));
  if (!fs.existsSync(resolved)) {
    logErr(`zai-watch: 配置文件不存在,忽略: ${resolved}`);
    return {};
  }
  const text = fs.readFileSync(resolved, 'utf8');
  // YAML 是 JSON 的超集,parseYaml 同时能吃 JSON;统一走它。
  const raw = (parseYaml(text) ?? {}) as Record<string, unknown>;
  return normalizeRaw(raw);
}

// ───────────────────────── cc-connect 汇报 ─────────────────────────

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** spawn cc-connect send,通过 stdin 写入消息(安全处理多行/特殊字符)。 */
function ccConnectSend(project: string, message: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn('cc-connect', ['send', '-p', project, '--stdin'], { env: process.env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message }));
    proc.stdin.write(message);
    proc.stdin.end();
  });
}

function buildMessage(cfg: ZaiWatchConfig, status: number | null, timeMs: number): string {
  const label = cfg.label ?? cfg.url;
  return [
    '✅ z.ai token 已可正常使用',
    `目标: ${label}`,
    `状态: HTTP ${status ?? '?'} · 用时 ${timeMs}ms`,
    `时间: ${fmtLocalTime()}`,
  ].join('\n');
}

/** 发送汇报,失败重试一次。无论成败都不抛(探活目标已达成)。 */
async function report(cfg: ZaiWatchConfig, status: number | null, timeMs: number): Promise<void> {
  const message = buildMessage(cfg, status, timeMs);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await ccConnectSend(cfg.project, message);
    if (r.code === 0) {
      logOut(`zai-watch: cc-connect 汇报成功 (project=${cfg.project})${r.stdout.trim() ? ` stdout=${r.stdout.trim()}` : ''}`);
      return;
    }
    logErr(
      `zai-watch: cc-connect 汇报失败 (attempt ${attempt}/2, code=${r.code}, project=${cfg.project})` +
        `${r.stdout.trim() ? ` stdout=${r.stdout.trim()}` : ''}${r.stderr.trim() ? ` stderr=${r.stderr.trim()}` : ''}`,
    );
    if (attempt < 2) await sleep(1500);
  }
  logErr(`zai-watch: cc-connect 汇报最终失败,但探活目标已达成,仍正常退出。`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ───────────────────────── 主循环 ─────────────────────────

const signal = { stopped: false };

function setupSignalHandlers(timerRef: { timer: NodeJS.Timeout | null }): void {
  const cleanup = (sig: string) => {
    if (signal.stopped) return;
    signal.stopped = true;
    if (timerRef.timer) clearInterval(timerRef.timer);
    logOut(`zai-watch: 收到 ${sig},退出。`);
    process.exit(0);
  };
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
}

async function runLoop(cfg: ZaiWatchConfig): Promise<void> {
  const timerRef: { timer: NodeJS.Timeout | null } = { timer: null };
  setupSignalHandlers(timerRef);

  logOut(
    `zai-watch started — ${cfg.method} ${cfg.url} interval=${cfg.intervalSec}s timeout=${cfg.timeoutSec}s ` +
      `successStatus=${cfg.successStatus} consecutive=${cfg.consecutive} project=${cfg.project}` +
      `${cfg.maxChecks ? ` maxChecks=${cfg.maxChecks}` : ''}`,
  );

  let streak = 0;
  let checks = 0;

  const tick = async (): Promise<void> => {
    if (signal.stopped) return;
    checks++;
    let res;
    try {
      res = await checkOnce(cfg.url, {
        timeoutMs: cfg.timeoutSec * 1000,
        successStatus: cfg.successStatus,
        mustInclude: cfg.mustInclude,
        mustNotInclude: cfg.mustNotInclude,
        method: cfg.method,
        headers: cfg.headers,
        body: cfg.body,
      });
    } catch (err) {
      // checkOnce 理论上不抛,这里兜底,绝不让一次探测打死守护。
      const msg = err instanceof Error ? err.message : String(err);
      res = { ok: false, status: null as number | null, timeMs: 0, error: msg };
    }

    if (res.ok) {
      streak++;
    } else {
      streak = 0;
    }

    logOut(
      `zai-watch: ${cfg.url} -> HTTP ${res.status ?? 'ERR'} (${res.timeMs}ms) ok=${res.ok} ` +
        `streak=${streak}/${cfg.consecutive}${res.error ? ` err=${res.error}` : ''}`,
    );

    if (streak >= cfg.consecutive) {
      if (timerRef.timer) clearInterval(timerRef.timer);
      logOut(`zai-watch: 连续 ${cfg.consecutive} 次 OK,目标已恢复访问,开始汇报。`);
      await report(cfg, res.status, res.timeMs);
      process.exit(0);
    }

    if (cfg.maxChecks && checks >= cfg.maxChecks) {
      if (timerRef.timer) clearInterval(timerRef.timer);
      logErr(`zai-watch: 达到 maxChecks=${cfg.maxChecks} 仍未恢复,放弃并退出(code=2)。`);
      process.exit(2);
    }
  };

  await tick();
  timerRef.timer = setInterval(() => {
    if (signal.stopped) return;
    void tick();
  }, cfg.intervalSec * 1000);
}

// ───────────────────────── --once / --dry-run ─────────────────────────

/**
 * 只跑一次探测,打印结果与「将要发送」的汇报文案,不经 cc-connect 发任何东西。
 * exit code:ok → 0,否则 1。供安全验证(避免误发真实飞书消息)。
 */
async function runOnce(cfg: ZaiWatchConfig): Promise<void> {
  logOut(`zai-watch --once — ${cfg.method} ${cfg.url} timeout=${cfg.timeoutSec}s successStatus=${cfg.successStatus}`);
  let res;
  try {
    res = await checkOnce(cfg.url, {
      timeoutMs: cfg.timeoutSec * 1000,
      successStatus: cfg.successStatus,
      mustInclude: cfg.mustInclude,
      mustNotInclude: cfg.mustNotInclude,
      method: cfg.method,
      headers: cfg.headers,
      body: cfg.body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res = { ok: false, status: null as number | null, timeMs: 0, error: msg };
  }

  logOut(
    `zai-watch --once 结果: ok=${res.ok} status=HTTP ${res.status ?? 'ERR'} timeMs=${res.timeMs}` +
      `${res.error ? ` error=${res.error}` : ''}`,
  );
  const message = buildMessage(cfg, res.status, res.timeMs);
  logOut(`zai-watch --once 将要发送的汇报(dry-run,未发送):\n${message}`);
  process.exit(res.ok ? 0 : 1);
}

// ───────────────────────── CLI ─────────────────────────

interface CliOptions {
  config?: string;
  url?: string;
  interval?: string;
  timeout?: string;
  successStatus?: string;
  consecutive?: string;
  mustInclude?: string;
  mustNotInclude?: string;
  method?: string;
  project?: string;
  label?: string;
  maxChecks?: string;
  once?: boolean;
  dryRun?: boolean;
}

/**
 * 合并优先级:CLI flag > 配置文件 > 内置默认值。
 * 同时对 url / headers / body 做 `${ENV}` 插值(从 env 注入,默认 process.env),
 * 并在 body 来自对象且未显式指定 content-type 时补 application/json。
 */
export function resolveConfig(
  opts: CliOptions,
  fileCfg: RawConfig,
  env: NodeJS.ProcessEnv = process.env,
): ZaiWatchConfig {
  const numOpt = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  // ${ENV} 插值:headers 的每个 value、body、url。
  let headers: Record<string, string> | undefined;
  if (fileCfg.headers) {
    headers = {};
    for (const [k, v] of Object.entries(fileCfg.headers)) headers[k] = interpolateEnv(v, env);
  }
  // body 来自对象且 headers 未声明 content-type → 补默认。
  if (fileCfg._bodyWasObject) {
    const hasContentType =
      headers && Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers = { ...(headers ?? {}), 'content-type': 'application/json' };
    }
  }
  const body = fileCfg.body !== undefined ? interpolateEnv(fileCfg.body, env) : undefined;

  const merged: ZaiWatchConfig = {
    url: interpolateEnv(opts.url ?? fileCfg.url ?? DEFAULTS.url, env),
    intervalSec: numOpt(opts.interval) ?? fileCfg.intervalSec ?? DEFAULTS.intervalSec,
    timeoutSec: numOpt(opts.timeout) ?? fileCfg.timeoutSec ?? DEFAULTS.timeoutSec,
    successStatus: opts.successStatus ?? fileCfg.successStatus ?? DEFAULTS.successStatus,
    consecutive: numOpt(opts.consecutive) ?? fileCfg.consecutive ?? DEFAULTS.consecutive,
    mustInclude: opts.mustInclude ?? fileCfg.mustInclude,
    mustNotInclude: opts.mustNotInclude ?? fileCfg.mustNotInclude,
    method: (opts.method ?? fileCfg.method ?? DEFAULTS.method).toUpperCase(),
    headers,
    body,
    project: opts.project ?? fileCfg.project ?? DEFAULTS.project,
    label: opts.label ?? fileCfg.label,
    maxChecks: numOpt(opts.maxChecks) ?? fileCfg.maxChecks,
  };
  if (merged.consecutive < 1) merged.consecutive = 1;
  return merged;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('zai-watch')
    .description('轮询某目标(默认 z.ai)是否恢复访问,连续 N 次 OK 后通过 cc-connect 汇报飞书并退出')
    .option('-c, --config <path>', '配置文件(YAML/JSON),如 ./local/zai-watch-config.yaml')
    .option('--url <url>', `探测目标 URL (默认 ${DEFAULTS.url})`)
    .option('--interval <sec>', `两次探测间隔秒数 (默认 ${DEFAULTS.intervalSec})`)
    .option('--timeout <sec>', `单次请求超时秒数 (默认 ${DEFAULTS.timeoutSec})`)
    .option('--success-status <spec>', `成功状态规格,逗号分隔含区间,如 "200,301-399" (默认 "${DEFAULTS.successStatus}")`)
    .option('--consecutive <n>', `判定可访问前所需的连续 OK 次数 (默认 ${DEFAULTS.consecutive})`)
    .option('--must-include <text>', '响应体必须包含的文本(可选)')
    .option('--must-not-include <text>', '响应体必须不包含的文本(可选,如封锁/错误页标记)')
    .option('--method <verb>', `HTTP 方法 (默认 ${DEFAULTS.method})`)
    .option('--project <name>', `cc-connect 汇报目标 project (默认 ${DEFAULTS.project})`)
    .option('--label <text>', '汇报中的友好名称(默认 = url)')
    .option('--max-checks <n>', '最多探测次数;到达仍未成功则以非 0 退出(默认不限)')
    .option('--once', '只探测一次,打印结果与「将要发送」的汇报文案,不发任何东西即退(ok→0 否则 1)')
    .option('--dry-run', '同 --once:只探测一次并 dry-run,不发送')
    .parse(process.argv);

  const opts = program.opts<CliOptions>();
  const fileCfg = opts.config ? loadConfigFile(opts.config) : {};
  const cfg = resolveConfig(opts, fileCfg);

  if (opts.once || opts.dryRun) {
    await runOnce(cfg);
    return;
  }

  await runLoop(cfg);
}

if (require.main === module) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
  });
}
