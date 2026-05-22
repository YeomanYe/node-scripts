#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeTask } from '../codex-task-runner/executor';
import { DefaultsConfig, SandboxMode, TaskConfig } from '../codex-task-runner/types';
import { sendFeishuCard, sendFeishuFile, sendFeishuImage, sendFeishuText } from '../shared/notifiers/feishu';
import { FeishuChannelConfig } from '../shared/notifiers/types';
import { buildTodoDriverNotification } from '../shared/todo-driver-report';

const FALLBACK_CODEX_MODEL = 'gpt-5.5';
const FEISHU_ATTACHMENT_SEND_DELAY_MS = 1200;

function readTomlSection(content: string, sectionName: string): Record<string, string> {
  const header = `[${sectionName}]`;
  const start = content.indexOf(header);
  if (start === -1) return {};
  const after = content.slice(start + header.length);
  const nextSectionMatch = after.match(/\n\s*\[/);
  const body = nextSectionMatch ? after.slice(0, nextSectionMatch.index) : after;
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^"?([\w.\-]+)"?\s*=\s*"?([\w.\-]+)"?\s*$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function versionRank(model: string): number {
  const m = model.match(/(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2] ?? '0', 10);
  return major * 10000 + minor * 100;
}

function readCodexAuthMode(): string {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.codex', 'auth.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { auth_mode?: unknown };
    return typeof parsed.auth_mode === 'string' ? parsed.auth_mode : '';
  } catch {
    return '';
  }
}

/**
 * 读 ~/.codex/config.toml,挑出当前账号能用的最先进模型。
 * 来源:[tui.model_availability_nux] 的 keys + [notice.model_migrations] 的 values.
 * ChatGPT 账号下过滤掉 -codex 后缀变体(那些只对 API key 开放).
 * 取不到时回退到 FALLBACK_CODEX_MODEL.
 */
export function resolveLatestCodexModel(): string {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return FALLBACK_CODEX_MODEL;
  }

  const candidates = new Set<string>();
  Object.keys(readTomlSection(content, 'tui.model_availability_nux')).forEach((k) =>
    candidates.add(k)
  );
  Object.values(readTomlSection(content, 'notice.model_migrations')).forEach((v) =>
    candidates.add(v)
  );

  const authMode = readCodexAuthMode();
  let pool = Array.from(candidates);
  if (authMode === 'chatgpt') {
    const nonCodex = pool.filter((m) => !m.endsWith('-codex'));
    if (nonCodex.length > 0) pool = nonCodex;
  }

  if (pool.length === 0) return FALLBACK_CODEX_MODEL;

  pool.sort((a, b) => {
    const diff = versionRank(b) - versionRank(a);
    if (diff !== 0) return diff;
    // API-key 用户:同版本下偏好 -codex 变体(为编码优化)
    if (authMode !== 'chatgpt') {
      return (b.endsWith('-codex') ? 1 : 0) - (a.endsWith('-codex') ? 1 : 0);
    }
    return 0;
  });
  return pool[0];
}

interface MinimalTask {
  name?: string;
  prompt: string;
  prompt_file?: string;
  workdir?: string;
  model?: string;
  sandbox_mode?: SandboxMode;
  dangerously_bypass?: boolean;
}

interface LoopDefaults {
  workdir?: string;
  model?: string;
  timeout_minutes?: number | null;
  sandbox_mode?: SandboxMode;
  dangerously_bypass?: boolean;
}

interface LoopConfig {
  tasks: MinimalTask[];
  defaults?: LoopDefaults;
  feishu?: FeishuChannelConfig;
}

const VALID_SANDBOX_MODES: ReadonlySet<SandboxMode> = new Set([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

function parseSandboxMode(raw: unknown, where: string): SandboxMode | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !VALID_SANDBOX_MODES.has(raw as SandboxMode)) {
    throw new Error(
      `${where} sandbox_mode must be one of: read-only, workspace-write, danger-full-access`
    );
  }
  return raw as SandboxMode;
}

function parseBypass(raw: unknown, where: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') throw new Error(`${where} dangerously_bypass must be boolean`);
  return raw;
}

function parseTimeoutMinutes(raw: unknown, where: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${where} timeout_minutes must be a finite number or null`);
  }
  return raw <= 0 ? null : raw;
}

function resolvePrompt(t: Record<string, unknown>, idx: number, configDir: string): Pick<MinimalTask, 'prompt' | 'prompt_file'> {
  if (typeof t.prompt === 'string' && t.prompt) {
    return {
      prompt: t.prompt,
      prompt_file: typeof t.prompt_file === 'string' ? t.prompt_file : undefined,
    };
  }
  if (typeof t.prompt_file !== 'string' || !t.prompt_file) {
    throw new Error(`task #${idx} missing required field "prompt" or "prompt_file"`);
  }
  const promptPath = path.isAbsolute(t.prompt_file)
    ? t.prompt_file
    : path.join(configDir, t.prompt_file);
  return {
    prompt: fs.readFileSync(promptPath, 'utf-8'),
    prompt_file: t.prompt_file,
  };
}

function validateTasks(raw: unknown, configDir: string): MinimalTask[] {
  if (!Array.isArray(raw)) {
    throw new Error('"tasks" must be an array');
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`task #${idx} must be an object`);
    }
    const t = item as Record<string, unknown>;
    const prompt = resolvePrompt(t, idx, configDir);
    return {
      name: typeof t.name === 'string' ? t.name : undefined,
      ...prompt,
      workdir: typeof t.workdir === 'string' ? t.workdir : undefined,
      model: typeof t.model === 'string' ? t.model : undefined,
      sandbox_mode: parseSandboxMode(t.sandbox_mode, `task #${idx}`),
      dangerously_bypass: parseBypass(t.dangerously_bypass, `task #${idx}`),
    };
  });
}

function validateDefaults(raw: unknown): LoopDefaults | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('"defaults" must be an object');
  const d = raw as Record<string, unknown>;
  return {
    workdir: typeof d.workdir === 'string' ? d.workdir : undefined,
    model: typeof d.model === 'string' ? d.model : undefined,
    timeout_minutes: parseTimeoutMinutes(d.timeout_minutes, 'defaults'),
    sandbox_mode: parseSandboxMode(d.sandbox_mode, 'defaults'),
    dangerously_bypass: parseBypass(d.dangerously_bypass, 'defaults'),
  };
}

function validateFeishu(raw: unknown): FeishuChannelConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('"feishu" must be an object');
  const f = raw as Record<string, unknown>;
  if (typeof f.app_id !== 'string' || typeof f.app_secret !== 'string' || typeof f.receive_id !== 'string') {
    throw new Error('"feishu" requires string fields: app_id, app_secret, receive_id');
  }
  return {
    type: 'feishu',
    app_id: f.app_id,
    app_secret: f.app_secret,
    receive_id: f.receive_id,
    receive_id_type:
      typeof f.receive_id_type === 'string'
        ? (f.receive_id_type as FeishuChannelConfig['receive_id_type'])
        : 'chat_id',
    domain: typeof f.domain === 'string' ? f.domain : undefined,
  };
}

export function loadConfig(configPath: string): LoopConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const configDir = path.dirname(path.resolve(configPath));
  if (Array.isArray(parsed)) {
    return { tasks: validateTasks(parsed, configDir) };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    return {
      tasks: validateTasks(obj.tasks, configDir),
      defaults: validateDefaults(obj.defaults),
      feishu: validateFeishu(obj.feishu),
    };
  }
  throw new Error('config must be a JSON array of tasks, or an object {tasks, defaults?, feishu?}');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isShuttingDown = false;
function setupSignals(): void {
  const stop = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    process.stdout.write('\n[loop] received signal, finishing current task then exiting...\n');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function safeNotify(
  feishu: FeishuChannelConfig | undefined,
  title: string,
  content: string,
  level: 'info' | 'warn'
): Promise<void> {
  if (!feishu) return;
  try {
    await sendFeishuCard(feishu, title, content, level);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[loop] feishu notify failed: ${msg}\n`);
  }
}

async function safeNotifyTaskResult(
  feishu: FeishuChannelConfig | undefined,
  taskName: string,
  result: Awaited<ReturnType<typeof executeTask>>,
  iter: number,
  totalCount: number
): Promise<void> {
  if (!feishu) return;
  const message = buildTodoDriverNotification(taskName, result, iter, totalCount);
  await safeNotify(feishu, message.title, message.content, message.level);
  for (let i = 0; i < message.attachments.length; i++) {
    const attachment = message.attachments[i];
    if (i > 0 || attachment.caption) {
      await sleep(FEISHU_ATTACHMENT_SEND_DELAY_MS);
    }
    if (attachment.caption) {
      await sendFeishuText(
        feishu,
        [
          `stage: ${message.stage ?? '-'}`,
          `slug: ${message.slug ?? '-'}`,
          `caption: ${attachment.caption}`,
          `${attachment.type}: ${attachment.path}`,
        ].join('\n')
      );
      await sleep(FEISHU_ATTACHMENT_SEND_DELAY_MS);
    }
    try {
      if (attachment.type === 'image') {
        await sendFeishuImage(feishu, attachment.path);
      } else {
        await sendFeishuFile(feishu, attachment.path);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[loop] feishu ${attachment.type} notify failed (${attachment.path}): ${msg}\n`);
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('codex-task-loop')
    .description('Run a sequence of Codex tasks repeatedly')
    .argument(
      '<config>',
      'JSON config: array of tasks, or {tasks, defaults?, feishu?}. ' +
        'tasks support prompt or prompt_file. ' +
        'defaults supports: workdir, model, timeout_minutes, sandbox_mode, dangerously_bypass'
    )
    .option('-n, --count <n>', 'Iterations of the whole sequence (0 = infinite)', '0')
    .option('-i, --interval-seconds <n>', 'Seconds to wait between iterations', '0')
    .option('--workdir <path>', 'Default workdir for tasks without one')
    .option(
      '--model <name>',
      'Default model. "auto" (default) auto-detects latest from ~/.codex/config.toml',
      'auto'
    )
    .option('--timeout-minutes <n>', 'Per-task timeout (minutes)', '15')
    .option(
      '--sandbox-mode <mode>',
      'Codex sandbox: read-only | workspace-write | danger-full-access (ignored when bypass is on)',
      'danger-full-access'
    )
    .option(
      '--dangerously-bypass',
      'Pass --dangerously-bypass-approvals-and-sandbox (use --no-dangerously-bypass to disable; default ON)',
      true
    )
    .option('--on-task-failure <mode>', 'continue | stop', 'continue')
    .option('--quiet-success', 'Do NOT send a Feishu card for successful tasks (failures still notify)', false);

  program.parse(process.argv);
  const opts = program.opts<{
    count: string;
    intervalSeconds: string;
    workdir?: string;
    model: string;
    timeoutMinutes: string;
    sandboxMode: string;
    dangerouslyBypass: boolean;
    onTaskFailure: string;
    quietSuccess: boolean;
  }>();
  const configPath = program.args[0];

  const { tasks, defaults: cfgDefaults, feishu } = loadConfig(configPath);
  if (tasks.length === 0) throw new Error('config has zero tasks');

  const totalCount = Math.max(0, parseInt(opts.count, 10) || 0);
  const intervalMs = Math.max(0, parseFloat(opts.intervalSeconds) * 1000);
  const onFailure: 'continue' | 'stop' = opts.onTaskFailure === 'stop' ? 'stop' : 'continue';
  const notifySuccessTasks = !Boolean(opts.quietSuccess);

  // Effective defaults: config-defaults > CLI flags > built-in
  const cliModelRaw = opts.model;
  const cliModel = cliModelRaw === 'auto' ? resolveLatestCodexModel() : cliModelRaw;
  if (cliModelRaw === 'auto' && !cfgDefaults?.model) {
    process.stdout.write(`[loop] auto-detected codex model: ${cliModel}\n`);
  }
  const effModel = cfgDefaults?.model ?? cliModel;
  const cliTimeoutMinutes = parseTimeoutMinutes(Number(opts.timeoutMinutes), 'CLI');
  const effTimeoutMinutes =
    cfgDefaults && cfgDefaults.timeout_minutes !== undefined
      ? cfgDefaults.timeout_minutes
      : cliTimeoutMinutes ?? 15;
  const effSandboxMode = cfgDefaults?.sandbox_mode ?? (opts.sandboxMode as SandboxMode);
  const effBypass = cfgDefaults?.dangerously_bypass ?? Boolean(opts.dangerouslyBypass);
  const effWorkdir = cfgDefaults?.workdir ?? opts.workdir;

  setupSignals();

  const countLabel = totalCount === 0 ? 'infinite' : String(totalCount);
  const modeLabel = effBypass ? 'bypass (max permission)' : `sandbox=${effSandboxMode}`;
  const timeoutLabel = effTimeoutMinutes === null ? 'off' : `${effTimeoutMinutes}m`;
  process.stdout.write(
    `[loop] tasks=${tasks.length} count=${countLabel} interval=${intervalMs / 1000}s` +
      ` model=${effModel} mode=${modeLabel} timeout=${timeoutLabel} feishu=${feishu ? 'on' : 'off'}\n`
  );

  await safeNotify(
    feishu,
    'Codex task loop 启动',
    [
      `- 任务数: ${tasks.length}`,
      `- 循环次数: ${countLabel}`,
      `- 间隔: ${intervalMs / 1000}s`,
      `- 模型: ${effModel}`,
      `- 权限模式: ${modeLabel}`,
      `- 单任务超时: ${timeoutLabel}`,
      `- 失败策略: ${onFailure}`,
    ].join('\n'),
    'info'
  );

  let iter = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let totalCostUsd = 0;
  let stopReason = 'completed';

  while (!isShuttingDown && (totalCount === 0 || iter < totalCount)) {
    iter++;
    process.stdout.write(`\n=== Iteration ${iter}${totalCount > 0 ? `/${totalCount}` : ''} ===\n`);

    for (let i = 0; i < tasks.length; i++) {
      if (isShuttingDown) break;
      const t = tasks[i];
      const taskConfig: TaskConfig = {
        name: t.name ?? `task-${i + 1}`,
        prompt: t.prompt,
        workdir: t.workdir ?? effWorkdir,
        model: t.model,
      };
      // Per-task overrides on sandbox/bypass; executor reads task.model vs defaults.model itself.
      const taskDefaults: DefaultsConfig = {
        model: effModel,
        sandbox_mode: t.sandbox_mode ?? effSandboxMode,
        dangerously_bypass_approvals_and_sandbox: t.dangerously_bypass ?? effBypass,
        timeout_minutes: effTimeoutMinutes,
        on_failure: onFailure,
      };
      const result = await executeTask(taskConfig, i + 1, taskDefaults);
      totalCostUsd += result.costUsd;

      const succeeded = result.status === 'success';
      if (succeeded) totalSuccess++;
      else totalFail++;

      const shouldNotify = !succeeded || notifySuccessTasks;
      if (shouldNotify) {
        await safeNotifyTaskResult(feishu, taskConfig.name, result, iter, totalCount);
      }

      if (!succeeded) {
        if (onFailure === 'stop') {
          stopReason = `task ${taskConfig.name} failed (${result.status})`;
          process.stderr.write(`[loop] ${stopReason}, on-task-failure=stop, exiting\n`);
          await safeNotify(
            feishu,
            'Codex task loop 终止',
            [
              `- 原因: ${stopReason}`,
              `- 已完成迭代: ${iter}`,
              `- 累计成功: ${totalSuccess}`,
              `- 累计失败: ${totalFail}`,
              `- 累计费用: $${totalCostUsd.toFixed(4)}`,
            ].join('\n'),
            'warn'
          );
          process.exit(1);
        }
      }
    }

    if (isShuttingDown) {
      stopReason = 'received signal';
      break;
    }

    if (intervalMs > 0 && (totalCount === 0 || iter < totalCount)) {
      process.stdout.write(`[loop] sleeping ${intervalMs / 1000}s before next iteration\n`);
      await sleep(intervalMs);
    }
  }

  process.stdout.write(`[loop] done after ${iter} iteration(s) — ${stopReason}\n`);

  await safeNotify(
    feishu,
    'Codex task loop 结束',
    [
      `- 原因: ${stopReason}`,
      `- 完成迭代: ${iter}`,
      `- 成功任务: ${totalSuccess}`,
      `- 失败任务: ${totalFail}`,
      `- 累计费用: $${totalCostUsd.toFixed(4)}`,
    ].join('\n'),
    totalFail > 0 ? 'warn' : 'info'
  );
}

if (require.main === module) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  });
}
