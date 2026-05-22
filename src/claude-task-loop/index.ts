#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { executeTask } from '../claude-task-runner/executor';
import { DefaultsConfig, PermissionMode, TaskConfig } from '../claude-task-runner/types';
import { sendFeishuCard, sendFeishuFile, sendFeishuImage, sendFeishuText } from '../shared/notifiers/feishu';
import { FeishuChannelConfig } from '../shared/notifiers/types';
import {
  TemplateVariables,
  collectTemplateVariables,
  renderTemplateString,
  renderTemplates,
} from '../shared/template-config';
import { buildTodoDriverNotification } from '../shared/todo-driver-report';

interface MinimalTask {
  name?: string;
  prompt: string;
  prompt_file?: string;
  workdir?: string;
  model?: string;
  max_budget?: number;
  permission_mode?: PermissionMode;
}

const FEISHU_ATTACHMENT_SEND_DELAY_MS = 1200;

interface LoopDefaults {
  workdir?: string;
  model?: string;
  max_budget?: number;
  timeout_minutes?: number;
  permission_mode?: PermissionMode;
}

interface LoopConfig {
  tasks: MinimalTask[];
  defaults?: LoopDefaults;
  feishu?: FeishuChannelConfig;
}

const VALID_PERMISSION_MODES: ReadonlySet<PermissionMode> = new Set([
  'default',
  'plan',
  'bypassPermissions',
]);

function parsePermissionMode(raw: unknown, where: string): PermissionMode | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !VALID_PERMISSION_MODES.has(raw as PermissionMode)) {
    throw new Error(`${where} permission_mode must be one of: default, plan, bypassPermissions`);
  }
  return raw as PermissionMode;
}

function resolvePrompt(
  t: Record<string, unknown>,
  idx: number,
  configDir: string,
  variables: TemplateVariables
): Pick<MinimalTask, 'prompt' | 'prompt_file'> {
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
    prompt: renderTemplateString(fs.readFileSync(promptPath, 'utf-8'), variables),
    prompt_file: t.prompt_file,
  };
}

function validateTasks(raw: unknown, configDir: string, variables: TemplateVariables): MinimalTask[] {
  if (!Array.isArray(raw)) {
    throw new Error('"tasks" must be an array');
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`task #${idx} must be an object`);
    }
    const t = item as Record<string, unknown>;
    const prompt = resolvePrompt(t, idx, configDir, variables);
    return {
      name: typeof t.name === 'string' ? t.name : undefined,
      ...prompt,
      workdir: typeof t.workdir === 'string' ? t.workdir : undefined,
      model: typeof t.model === 'string' ? t.model : undefined,
      max_budget: typeof t.max_budget === 'number' ? t.max_budget : undefined,
      permission_mode: parsePermissionMode(t.permission_mode, `task #${idx}`),
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
    max_budget: typeof d.max_budget === 'number' ? d.max_budget : undefined,
    timeout_minutes: typeof d.timeout_minutes === 'number' ? d.timeout_minutes : undefined,
    permission_mode: parsePermissionMode(d.permission_mode, 'defaults'),
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
  const variables = collectTemplateVariables(parsed);
  const rendered = renderTemplates(parsed, variables);
  if (Array.isArray(rendered)) {
    return { tasks: validateTasks(rendered, configDir, variables) };
  }
  if (typeof rendered === 'object' && rendered !== null) {
    const obj = rendered as Record<string, unknown>;
    return {
      tasks: validateTasks(obj.tasks, configDir, variables),
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
    .name('claude-task-loop')
    .description('Run a sequence of Claude tasks repeatedly')
    .argument(
      '<config>',
      'JSON config: array of tasks, or {tasks, defaults?, feishu?}. ' +
        'tasks support prompt or prompt_file. ' +
        'defaults supports: workdir, model, max_budget, timeout_minutes, permission_mode'
    )
    .option('-n, --count <n>', 'Iterations of the whole sequence (0 = infinite)', '0')
    .option('-i, --interval-seconds <n>', 'Seconds to wait between iterations', '0')
    .option('--workdir <path>', 'Default workdir for tasks without one')
    .option('--model <name>', 'Default model', 'sonnet')
    .option('--max-budget <usd>', 'Default per-task max budget (USD)', '1.0')
    .option('--timeout-minutes <n>', 'Per-task timeout (minutes)', '15')
    .option(
      '--permission-mode <mode>',
      'Claude permission mode: default | plan | bypassPermissions',
      'bypassPermissions'
    )
    .option('--on-task-failure <mode>', 'continue | stop', 'continue')
    .option('--quiet-success', 'Do NOT send a Feishu card for successful tasks (failures still notify)', false);

  program.parse(process.argv);
  const opts = program.opts<{
    count: string;
    intervalSeconds: string;
    workdir?: string;
    model: string;
    maxBudget: string;
    timeoutMinutes: string;
    permissionMode: string;
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
  const effModel = cfgDefaults?.model ?? opts.model;
  const effMaxBudget = cfgDefaults?.max_budget ?? parseFloat(opts.maxBudget);
  const effTimeoutMinutes = cfgDefaults?.timeout_minutes ?? parseInt(opts.timeoutMinutes, 10);
  const effPermissionMode =
    cfgDefaults?.permission_mode ?? (opts.permissionMode as PermissionMode);
  const effWorkdir = cfgDefaults?.workdir ?? opts.workdir;

  setupSignals();

  const countLabel = totalCount === 0 ? 'infinite' : String(totalCount);
  process.stdout.write(
    `[loop] tasks=${tasks.length} count=${countLabel} interval=${intervalMs / 1000}s` +
      ` model=${effModel} permission_mode=${effPermissionMode} feishu=${feishu ? 'on' : 'off'}\n`
  );

  await safeNotify(
    feishu,
    'Claude task loop 启动',
    [
      `- 任务数: ${tasks.length}`,
      `- 循环次数: ${countLabel}`,
      `- 间隔: ${intervalMs / 1000}s`,
      `- 模型: ${effModel}`,
      `- 权限模式: ${effPermissionMode}`,
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
        max_budget: t.max_budget,
      };
      // Per-task overrides on permission_mode; other fields are handled by executor reading task vs defaults.
      const taskDefaults: DefaultsConfig = {
        model: effModel,
        max_budget_usd: effMaxBudget,
        permission_mode: t.permission_mode ?? effPermissionMode,
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
            'Claude task loop 终止',
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
    'Claude task loop 结束',
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
