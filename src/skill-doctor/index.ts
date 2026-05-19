#!/usr/bin/env node

import { Command } from 'commander';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { loadFeishuConfig } from './config';
import { runFixers } from './fix/runner';
import { maybeSendFeishu, type NotifyMode } from './notify/feishu';
import { renderJson } from './reporters/json';
import { renderText } from './reporters/text';
import { runDoctor } from './runner';

export interface CliResult {
  code: number;
  output: string;
}

type OutputFormat = 'text' | 'json';

const execFileAsync = promisify(execFile);

interface CliOptions {
  root: string;
  rules?: string;
  format: string;
  notify: string;
  feishuConfig?: string;
  color: boolean;
  fix?: boolean;
  apply?: boolean;
  dryRun?: boolean;
}

function parseRules(rules: string | undefined): string[] | undefined {
  return rules ? rules.split(',').map((rule) => rule.trim()).filter((rule) => rule.length > 0) : undefined;
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === 'text' || value === 'json';
}

function isNotifyMode(value: string): value is NotifyMode {
  return value === 'on-error' || value === 'always' || value === 'off';
}

async function ensureRootExists(root: string): Promise<void> {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`root is not a directory: ${root}`);
  }
}

async function ensureCleanWorkingTree(): Promise<void> {
  const { stdout } = await execFileAsync('git', ['status', '--short']);
  if (stdout.trim().length > 0) {
    throw new Error('Working tree not clean; commit or stash first');
  }
}

export async function runMain(argv: string[]): Promise<CliResult> {
  const program = new Command();
  program
    .name('skill-doctor')
    .description('Lint Claude skills directory')
    .option('--root <dir>', 'skills repo root', path.join(os.homedir(), 'Documents', 'projects', 'skills'))
    .option('--rules <ids>', 'comma-separated rule ids (default: all)')
    .option('--format <fmt>', 'output format: text|json', 'text')
    .option('--notify <mode>', 'feishu notify: on-error|always|off', 'on-error')
    .option('--feishu-config <path>', 'feishu config json path')
    .option('--fix', 'run deterministic fixers instead of rules')
    .option('--apply', 'apply fixes; requires --fix')
    .option('--dry-run', 'preview fixes without changing files')
    .option('--no-color', 'disable color in text output')
    .allowExcessArguments(false)
    .exitOverride();

  let parsed: Command;
  try {
    parsed = program.parse(argv, { from: 'user' });
  } catch (err) {
    return { code: 2, output: err instanceof Error ? err.message : String(err) };
  }

  const opts = parsed.opts<CliOptions>();
  if (!isOutputFormat(opts.format)) {
    return { code: 2, output: `invalid --format: ${opts.format}` };
  }
  if (!isNotifyMode(opts.notify)) {
    return { code: 2, output: `invalid --notify: ${opts.notify}` };
  }
  if (opts.apply && !opts.fix) {
    return { code: 2, output: '--apply requires --fix' };
  }
  const notifySource = parsed.getOptionValueSource('notify');
  if (opts.fix && notifySource === 'cli' && opts.notify !== 'off') {
    return { code: 2, output: '--fix cannot be combined with --notify' };
  }

  try {
    await ensureRootExists(opts.root);
  } catch (err) {
    return { code: 2, output: err instanceof Error ? err.message : String(err) };
  }

  if (opts.fix && opts.apply) {
    try {
      await ensureCleanWorkingTree();
    } catch (err) {
      return { code: 2, output: err instanceof Error ? err.message : String(err) };
    }
  }

  const report = opts.fix
    ? await runFixers({ root: opts.root, ruleIds: parseRules(opts.rules), dryRun: !opts.apply })
    : await runDoctor({ root: opts.root, ruleIds: parseRules(opts.rules) });
  const output = opts.format === 'json'
    ? renderJson(report)
    : renderText(report, { color: opts.color !== false });

  if (!opts.fix && opts.notify !== 'off') {
    try {
      const config = await loadFeishuConfig(opts.feishuConfig);
      if (config) {
        await maybeSendFeishu(report, config, opts.notify);
      }
    } catch (err) {
      process.stderr.write(`[skill-doctor] feishu notify failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  const code = report.fix_errors && report.fix_errors.length > 0
    ? 2
    : report.counts.error > 0 ? 2 : report.counts.warn > 0 ? 1 : 0;
  return { code, output };
}

if (require.main === module) {
  runMain(process.argv.slice(2)).then(({ code, output }) => {
    process.stdout.write(`${output}\n`);
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(2);
  });
}
