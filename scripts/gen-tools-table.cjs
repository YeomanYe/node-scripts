#!/usr/bin/env node
'use strict';

/**
 * gen-tools-table —— 文档/代码契约自动化。
 *
 * 单一事实来源：package.json 的 `bin` 字段（已注册的工具集）。
 * 本脚本从 bin 生成工具清单 markdown 表，并校验 README.md / CLAUDE.md
 * 中由 sentinel 标记圈定的表区是否与 bin 对齐，漂移即报错。
 *
 * 用法:
 *   node scripts/gen-tools-table.cjs            # 校验(默认)，漂移则 exit 1
 *   node scripts/gen-tools-table.cjs --check    # 同上，显式
 *   node scripts/gen-tools-table.cjs --write    # 把生成的表写回 README/CLAUDE
 *
 * 维护说明:
 *   - 新增/删除工具 = 改 package.json.bin。改完跑 --write 同步文档。
 *   - 工具一句话说明维护在下方 DESCRIPTIONS 映射；缺失时回退占位文案
 *     并在 --check 时报错，逼迫补齐，避免文档静默落后。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// README 表用的中文说明 + 锚点；CLAUDE 表用的英文 entry 说明。
// key = bin 名（= package.json.bin 的键）。
const TOOLS = {
  'auto-cmd': {
    anchor: 'auto-cmd',
    zh: '自动化命令执行调度器',
    en: 'Scheduled command execution (JSON/YAML config, time-based triggers, once/repeat modes)',
  },
  'sync-editor': {
    anchor: 'sync-editor',
    zh: 'VSCode / Cursor / Trae 配置同步',
    en: 'Bidirectional settings sync across VSCode/Cursor/Trae (settings, keybindings, extensions)',
  },
  'exec-recursive': {
    anchor: 'exec-recursive',
    zh: '递归执行命令',
    en: 'DFS recursive command execution with depth control',
  },
  'claude-usage': {
    anchor: 'claude-usage',
    zh: 'Claude API 用量查看',
    en: 'Claude API usage reporting (Anthropic OAuth, watch/json modes)',
  },
  'codex-usage': {
    anchor: 'codex-usage',
    zh: 'Codex / ChatGPT 用量查看',
    en: 'Codex / ChatGPT usage reporting from ~/.codex/auth.json',
  },
  'minimax-usage': {
    anchor: 'minimax-usage',
    zh: 'MiniMax Token Plan 用量查看',
    en: 'MiniMax Token Plan usage reporting, optional Feishu notify/poll',
  },
  'zai-usage': {
    anchor: 'zai-usage',
    zh: 'Z.ai (智谱) Coding Plan 用量查看',
    en: 'Z.ai (Zhipu) Coding Plan usage reporting via HTTP, with Feishu notification',
  },
  'zai-watch': {
    anchor: 'zai-watch',
    zh: '轮询目标直到 OK 后报飞书并退出',
    en: 'Poll a target until OK (N consecutive probes) then report to Feishu and exit; supports authenticated HTTP probes and --once/--dry-run',
  },
  'llm-gated-run': {
    anchor: 'llm-gated-run',
    zh: '根据 MiniMax 线性窗口额度执行已注册任务',
    en: 'Run registered tasks gated by a provider window linear budget (minimax)',
  },
  'claude-task-runner': {
    anchor: 'claude-task-runner',
    zh: 'Claude 自动化任务调度',
    en: 'Automated Claude Code task execution with usage-adaptive parallelism and Feishu notification',
  },
  'codex-task-runner': {
    anchor: 'codex-task-runner',
    zh: 'Codex 自动化任务调度',
    en: 'Automated Codex CLI task batching, concurrency driven by codex-usage',
  },
  'claude-task-loop': {
    anchor: 'task-loop',
    zh: 'Claude 循环任务执行',
    en: 'Loop Claude tasks from JSON config with variable interpolation',
  },
  'codex-task-loop': {
    anchor: 'task-loop',
    zh: 'Codex 循环任务执行',
    en: 'Loop Codex tasks from JSON config with variable interpolation',
  },
  'git-pull-poll': {
    anchor: 'git-pull-poll',
    zh: '轮询 git pull --ff-only 拉取更新',
    en: 'Poll git pull --ff-only to keep a repo up to date (drives post-merge rebuild)',
  },
  'boot-tasks': {
    anchor: 'boot-tasks',
    zh: '开机/启动时按配置批量拉起后台任务',
    en: 'Launch configured background tasks on boot/startup',
  },
  'skill-doctor': {
    anchor: 'skill-doctor',
    zh: 'Claude skills 仓库体检（lint）',
    en: 'Static lint/health check for a Claude skills repo (cross-platform, pure Node)',
  },
  'skillshare-sync-notify': {
    anchor: 'skillshare-sync-notify',
    zh: 'skillshare 同步并把结果通知飞书',
    en: 'Run skillshare sync and report the result to Feishu',
  },
  'system-status': {
    anchor: 'system-status',
    zh: '本机系统状态采集/上报',
    en: 'Collect and report local system status',
  },
  'knowledge-sync': {
    anchor: 'knowledge-sync',
    zh: '同步本地 knowledge 到 LLM Wiki 源',
    en: 'Sync ~/Documents/knowledge into LLM Wiki sources (once / watch modes)',
  },
  'usage-report': {
    anchor: 'usage-report',
    zh: '聚合多家 LLM 用量并出报告',
    en: 'Aggregate multi-provider LLM usage into a single report',
  },
};

function readBin() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.bin || {};
}

/** 返回 bin 顺序的工具名数组（package.json 里的声明顺序）。 */
function binNames() {
  return Object.keys(readBin());
}

/** 校验 TOOLS 映射与 bin 是否一一对应；返回问题列表。 */
function auditDescriptions() {
  const problems = [];
  const names = binNames();
  for (const name of names) {
    if (!TOOLS[name]) {
      problems.push(`bin "${name}" 在 package.json 注册但 scripts/gen-tools-table.cjs 的 TOOLS 映射缺少说明，请补充。`);
    }
  }
  for (const name of Object.keys(TOOLS)) {
    if (!names.includes(name)) {
      problems.push(`TOOLS 映射有 "${name}" 但 package.json.bin 已无此项，请移除。`);
    }
  }
  return problems;
}

/** 生成 README 中文工具表（不含 sentinel）。 */
function buildReadmeTable() {
  const lines = ['| 工具 | 说明 |', '|------|------|'];
  for (const name of binNames()) {
    const t = TOOLS[name] || { anchor: name, zh: '(待补充说明)' };
    lines.push(`| [${name}](#${t.anchor}) | ${t.zh} |`);
  }
  return lines.join('\n');
}

/** 生成 CLAUDE.md 英文工具表（不含 sentinel）。 */
function buildClaudeTable() {
  const lines = ['| Tool | Entry | Purpose |', '|------|-------|---------|'];
  for (const name of binNames()) {
    const t = TOOLS[name] || { en: '(description pending)' };
    // claude-task-loop / codex-task-loop 都映射到 src/<name>/index.ts
    lines.push(`| **${name}** | \`src/${name}/index.ts\` | ${t.en} |`);
  }
  return lines.join('\n');
}

const README_BEGIN = '<!-- TOOLS-TABLE:BEGIN (generated by scripts/gen-tools-table.cjs --write; do not edit between markers) -->';
const README_END = '<!-- TOOLS-TABLE:END -->';
const CLAUDE_BEGIN = '<!-- TOOLS-TABLE:BEGIN (generated by scripts/gen-tools-table.cjs --write; do not edit between markers) -->';
const CLAUDE_END = '<!-- TOOLS-TABLE:END -->';

function replaceBetween(content, begin, end, body, fileLabel) {
  const bi = content.indexOf(begin);
  const ei = content.indexOf(end);
  if (bi === -1 || ei === -1 || ei < bi) {
    throw new Error(
      `${fileLabel} 缺少 TOOLS-TABLE sentinel 标记（${begin} ... ${end}）。请先手动放置标记包住工具表。`
    );
  }
  const before = content.slice(0, bi + begin.length);
  const after = content.slice(ei);
  return `${before}\n\n${body}\n\n${after}`;
}

/** 抽取两个 sentinel 之间的正文（去首尾空白），用于 check 比对。 */
function extractBetween(content, begin, end) {
  const bi = content.indexOf(begin);
  const ei = content.indexOf(end);
  if (bi === -1 || ei === -1 || ei < bi) return null;
  return content.slice(bi + begin.length, ei).trim();
}

const README_PATH = path.join(ROOT, 'README.md');
const CLAUDE_PATH = path.join(ROOT, 'CLAUDE.md');

function writeDocs() {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const claude = fs.readFileSync(CLAUDE_PATH, 'utf8');
  fs.writeFileSync(
    README_PATH,
    replaceBetween(readme, README_BEGIN, README_END, buildReadmeTable(), 'README.md'),
    'utf8'
  );
  fs.writeFileSync(
    CLAUDE_PATH,
    replaceBetween(claude, CLAUDE_BEGIN, CLAUDE_END, buildClaudeTable(), 'CLAUDE.md'),
    'utf8'
  );
}

/** 返回 { ok, problems[] }。 */
function checkDocs() {
  const problems = auditDescriptions();
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const claude = fs.readFileSync(CLAUDE_PATH, 'utf8');

  const readmeActual = extractBetween(readme, README_BEGIN, README_END);
  const claudeActual = extractBetween(claude, CLAUDE_BEGIN, CLAUDE_END);

  if (readmeActual === null) {
    problems.push('README.md 缺少 TOOLS-TABLE sentinel 标记。');
  } else if (readmeActual !== buildReadmeTable()) {
    problems.push('README.md 工具表与 package.json.bin 漂移，请运行 `node scripts/gen-tools-table.cjs --write`。');
  }

  if (claudeActual === null) {
    problems.push('CLAUDE.md 缺少 TOOLS-TABLE sentinel 标记。');
  } else if (claudeActual !== buildClaudeTable()) {
    problems.push('CLAUDE.md 工具表与 package.json.bin 漂移，请运行 `node scripts/gen-tools-table.cjs --write`。');
  }

  return { ok: problems.length === 0, problems };
}

module.exports = {
  readBin,
  binNames,
  auditDescriptions,
  buildReadmeTable,
  buildClaudeTable,
  checkDocs,
  writeDocs,
  TOOLS,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--write')) {
    writeDocs();
    console.log('[gen-tools-table] 已把工具表写回 README.md / CLAUDE.md。');
    process.exit(0);
  }
  // 默认 / --check
  const { ok, problems } = checkDocs();
  if (ok) {
    console.log('[gen-tools-table] 文档工具表与 package.json.bin 一致。');
    process.exit(0);
  }
  console.error('[gen-tools-table] 文档/代码契约不一致:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
