#!/usr/bin/env node

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

type SourceName = 'hacker-news' | 'google-news' | 'arxiv-ai' | 'github';

interface RawItem {
  id: string;
  source: SourceName;
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
  score?: number;
}

interface ScoredItem extends RawItem {
  isNew: boolean;
  rankScore: number;
  terms: string[];
}

interface SourceResult {
  source: SourceName;
  ok: boolean;
  items: RawItem[];
  error?: string;
}

interface MonitorState {
  seen: Record<string, string>;
  runs: number;
  lastRunAt?: string;
}

interface RunOptions {
  statePath: string;
  intervalMinutes: number;
  limit: number;
  send: boolean;
  logFile?: string;
}

const DEFAULT_STATE_PATH = path.join(os.homedir(), '.local/state/hotword-monitor/state.json');
const USER_AGENT = 'hotword-monitor/0.1 (+local script)';
const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'and',
  'are',
  'around',
  'best',
  'but',
  'can',
  'for',
  'from',
  'github',
  'has',
  'have',
  'how',
  'into',
  'its',
  'new',
  'not',
  'now',
  'nbsp',
  'official',
  'open',
  'our',
  'over',
  'repo',
  'that',
  'the',
  'this',
  'today',
  'using',
  'via',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
]);

const NOISE_PATTERNS = [
  /\bcanva pro\b/i,
  /\bfree access\b/i,
  /\bfree download\b/i,
  /\bfree install\b/i,
  /\bbest free\b/i,
  /\blifetime\b/i,
  /\bultimate\b/i,
  /\bunlimited\b/i,
  /\bactivation\b/i,
  /\bactivator\b/i,
  /\bcrack(?:ed)?\b/i,
  /\bcheat\b/i,
  /\blicen[cs]e key\b/i,
  /\bmod apk\b/i,
  /\bpirate(?:d)?\b/i,
];

const SOURCES: Array<{ name: SourceName; fetch: () => Promise<RawItem[]> }> = [
  { name: 'hacker-news', fetch: fetchHackerNews },
  { name: 'google-news', fetch: fetchGoogleNews },
  { name: 'arxiv-ai', fetch: fetchArxiv },
  { name: 'github', fetch: fetchGithub },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function sourceWeight(source: SourceName): number {
  if (source === 'google-news') return 25;
  if (source === 'github') return 20;
  if (source === 'hacker-news') return 18;
  return 12;
}

function extractTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9+.-]+/g, ' ')
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  const terms = new Set<string>();
  for (const word of words) {
    if (/[a-z]/.test(word)) terms.add(word);
  }
  for (let i = 0; i < words.length - 1; i += 1) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (pair.includes('ai') || pair.includes('agent') || pair.includes('model')) {
      terms.add(pair);
    }
  }
  return Array.from(terms).slice(0, 8);
}

function recencyScore(publishedAt?: string): number {
  if (!publishedAt) return 0;
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return 0;
  const ageHours = Math.max(0, (Date.now() - time) / 3_600_000);
  if (ageHours <= 6) return 20;
  if (ageHours <= 24) return 12;
  if (ageHours <= 72) return 5;
  return 0;
}

function itemScore(item: RawItem, isNew: boolean): number {
  return sourceWeight(item.source) + recencyScore(item.publishedAt) + (item.score ?? 0) / 10 + (isNew ? 15 : 0);
}

function isNoiseItem(item: RawItem): boolean {
  const text = `${item.title} ${item.summary ?? ''}`;
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json, application/rss+xml, application/xml, text/xml, text/html',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

async function fetchHackerNews(): Promise<RawItem[]> {
  const data = await fetchJson<{
    hits: Array<{
      objectID: string;
      title?: string;
      url?: string;
      story_url?: string;
      created_at?: string;
      points?: number;
      num_comments?: number;
    }>;
  }>('https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI');

  return data.hits
    .filter((hit) => hit.title)
    .slice(0, 20)
    .map((hit) => ({
      id: `hn:${hit.objectID}`,
      source: 'hacker-news',
      title: hit.title ?? '',
      url: hit.url ?? hit.story_url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      publishedAt: hit.created_at,
      score: (hit.points ?? 0) + (hit.num_comments ?? 0) * 2,
    }));
}

async function fetchGoogleNews(): Promise<RawItem[]> {
  const queries = [
    'AI tools OR AI agent OR image generator when:1d',
    'artificial intelligence startup OR AI model OR AI agent when:1d',
  ];
  let lastError: unknown;
  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        q: query,
        hl: 'en-US',
        gl: 'US',
        ceid: 'US:en',
      });
      return parseRss(await fetchText(`https://news.google.com/rss/search?${params.toString()}`), 'google-news')
        .filter((item) => !isNoiseItem(item))
        .slice(0, 30);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchArxiv(): Promise<RawItem[]> {
  return parseRss(await fetchText('https://export.arxiv.org/rss/cs.AI'), 'arxiv-ai').slice(0, 20);
}

async function fetchGithub(): Promise<RawItem[]> {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const queries = [`topic:llm created:>${since} stars:>5`, `topic:agents created:>${since} stars:>5`];
  const responses = await Promise.all(queries.map((queryText) => {
    const query = new URLSearchParams({
      q: queryText,
      sort: 'stars',
      order: 'desc',
      per_page: '20',
    });
    return fetchJson<{
      items: Array<{
        id: number;
        full_name: string;
        html_url: string;
        description?: string | null;
        created_at: string;
        stargazers_count: number;
      }>;
    }>(`https://api.github.com/search/repositories?${query.toString()}`);
  }));
  const repos: Array<{
    id: number;
    full_name: string;
    html_url: string;
    description?: string | null;
    created_at: string;
    stargazers_count: number;
  }> = [];
  const seen = new Set<number>();
  for (const response of responses) {
    for (const repo of response.items) {
      if (seen.has(repo.id)) continue;
      seen.add(repo.id);
      repos.push(repo);
    }
  }
  repos.sort((a, b) => b.stargazers_count - a.stargazers_count);

  return repos
    .map((repo) => ({
      id: `github:${repo.id}`,
      source: 'github' as const,
      title: repo.full_name,
      url: repo.html_url,
      publishedAt: repo.created_at,
      summary: repo.description ?? undefined,
      score: repo.stargazers_count,
    }))
    .filter((item) => !isNoiseItem(item))
    .slice(0, 20);
}

function parseRss(xml: string, source: SourceName): RawItem[] {
  const itemBlocks = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]);
  return itemBlocks.map((block, index) => {
    const title = getXmlValue(block, 'title') || '(untitled)';
    const link = getXmlValue(block, 'link') || '';
    const guid = getXmlValue(block, 'guid') || link || `${source}:${index}:${title}`;
    return {
      id: `${source}:${guid}`,
      source,
      title,
      url: link,
      publishedAt: getXmlValue(block, 'pubDate') || getXmlValue(block, 'dc:date'),
      summary: getXmlValue(block, 'description'),
    };
  });
}

function getXmlValue(block: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  if (!match?.[1]) return undefined;
  return normalizeWhitespace(stripTags(decodeEntities(match[1])));
}

async function readState(statePath: string): Promise<MonitorState> {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8')) as MonitorState;
  } catch {
    return { seen: {}, runs: 0 };
  }
}

async function writeState(statePath: string, state: MonitorState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function collectSources(): Promise<SourceResult[]> {
  return Promise.all(
    SOURCES.map(async (source) => {
      try {
        const items = await withTimeout(source.fetch(), 45_000, `${source.name} timed out`);
        return { source: source.name, ok: true, items };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { source: source.name, ok: false, items: [], error: message };
      }
    }),
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function scoreItems(items: RawItem[], state: MonitorState): ScoredItem[] {
  const deduped = new Map<string, RawItem>();
  for (const item of items) {
    if (!item.title.trim()) continue;
    if (isNoiseItem(item)) continue;
    deduped.set(item.id, item);
  }
  return Array.from(deduped.values())
    .map((item) => {
      const isNew = !state.seen[item.id];
      const terms = extractTerms(`${item.title} ${item.summary ?? ''}`);
      return { ...item, isNew, terms, rankScore: itemScore(item, isNew) };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}

function summarizeTerms(items: ScoredItem[]): string[] {
  const scores = new Map<string, number>();
  for (const item of items) {
    for (const term of item.terms) {
      scores.set(term, (scores.get(term) ?? 0) + item.rankScore);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term);
}

function buildMessage(results: SourceResult[], scored: ScoredItem[], state: MonitorState, limit: number): string {
  const now = new Date();
  const newItems = scored.filter((item) => item.isNew);
  const headlineItems = (newItems.length > 0 ? newItems : scored).slice(0, limit);
  const terms = summarizeTerms(scored);
  const status = results
    .map((result) => `${result.ok ? '✅' : '⚠️'} ${result.source}: ${result.ok ? `${result.items.length} 条` : result.error}`)
    .join('\n');

  const lines = [
    `热词快站监控 · ${now.toLocaleString('zh-CN', { hour12: false })}`,
    '',
    `本轮新增：${newItems.length} 条；累计运行：${state.runs + 1} 次`,
    '',
    '数据源状态：',
    status,
    '',
    '候选热词：',
    terms.length > 0 ? terms.map((term) => `- ${term}`).join('\n') : '- 暂无',
    '',
    headlineItems.length > 0 ? '重点消息：' : '重点消息：暂无',
    ...headlineItems.map((item, index) => {
      const tag = item.isNew ? 'NEW' : 'OLD';
      const summary = item.summary ? `\n  ${item.summary.slice(0, 100)}` : '';
      return `${index + 1}. [${tag}] ${item.title}\n  ${item.source} · score ${Math.round(item.rankScore)}\n  ${item.url}${summary}`;
    }),
  ];

  return lines.join('\n');
}

async function sendViaCcConnect(message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.CC_CONNECT_BIN ?? 'cc-connect', ['send', '--stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `cc-connect exited with ${code}`));
      }
    });
    child.stdin.end(message);
  });
}

async function appendLog(file: string | undefined, message: string): Promise<void> {
  if (!file) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${new Date().toISOString()} ${message}\n`);
}

async function runOnce(options: RunOptions): Promise<void> {
  await appendLog(options.logFile, 'run started');
  const state = await readState(options.statePath);
  const results = await collectSources();
  const scored = scoreItems(
    results.flatMap((result) => result.items),
    state,
  );
  const message = buildMessage(results, scored, state, options.limit);

  const nextState: MonitorState = {
    seen: { ...state.seen },
    runs: state.runs + 1,
    lastRunAt: new Date().toISOString(),
  };
  for (const item of scored) {
    nextState.seen[item.id] = item.publishedAt ?? new Date().toISOString();
  }
  await writeState(options.statePath, nextState);

  if (options.send) {
    await sendViaCcConnect(message);
  } else {
    process.stdout.write(`${message}\n`);
  }
  await appendLog(options.logFile, `run ok: ${scored.length} items, send=${options.send}`);
}

async function runLoop(options: RunOptions): Promise<void> {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!stopped) {
    try {
      await runOnce(options);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      await appendLog(options.logFile, `run failed: ${message}`);
      if (options.send) {
        await sendViaCcConnect(`热词快站监控异常\n\n${message.slice(0, 1500)}`).catch(() => undefined);
      } else {
        process.stderr.write(`${message}\n`);
      }
    }
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMinutes * 60_000));
  }
}

interface CliArgs {
  command: 'run' | 'once';
  statePath: string;
  intervalMinutes: number;
  limit: number;
  send: boolean;
  logFile?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const [command = 'once', ...rest] = argv;
  if (command !== 'run' && command !== 'once') {
    throw new Error(`Unknown command "${command}". Use "run" or "once".`);
  }
  const args: CliArgs = {
    command,
    statePath: DEFAULT_STATE_PATH,
    intervalMinutes: 10,
    limit: 10,
    send: true,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--no-send') {
      args.send = false;
      continue;
    }
    const value = rest[i + 1];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === '--state') args.statePath = value;
    else if (arg === '--interval-minutes') args.intervalMinutes = Number(value);
    else if (arg === '--limit') args.limit = Number(value);
    else if (arg === '--log-file') args.logFile = value;
    else throw new Error(`Unknown option ${arg}`);
    i += 1;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const options: RunOptions = {
    statePath: args.statePath,
    intervalMinutes: args.intervalMinutes,
    limit: args.limit,
    send: args.send,
    logFile: args.logFile,
  };
  if (args.command === 'run') {
    await runLoop(options);
  } else {
    await runOnce(options);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
