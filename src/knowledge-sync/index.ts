#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DEFAULT_SOURCE_ROOT,
  DEFAULT_TARGET_ROOT,
  applyKnowledgeSync,
  defaultStatePath,
} from './sync';

interface OnceOptions {
  source: string;
  target: string;
  state?: string;
  ignore?: string;
  apply?: boolean;
  rescan?: boolean;
  apiBase: string;
  projectId?: string;
}

const program = new Command();

program
  .name('knowledge-sync')
  .description('Sync ~/Documents/knowledge into LLM Wiki raw/sources/knowledge')
  .version('1.0.0');

program
  .command('once', { isDefault: true })
  .description('Run one sync pass. Dry-run by default; pass --apply to write changes.')
  .option('--source <path>', 'Source knowledge directory', DEFAULT_SOURCE_ROOT)
  .option('--target <path>', 'Target LLM Wiki raw source directory', DEFAULT_TARGET_ROOT)
  .option('--state <path>', 'Sync state JSON path; defaults to <source>/.llm-wiki-sync-state.json')
  .option('--ignore <path>', 'Extra ignore file; defaults to <source>/.llm-wiki-syncignore')
  .option('--apply', 'Copy/delete files and update state')
  .option('--no-rescan', 'Do not call LLM Wiki rescan after an applied sync')
  .option('--api-base <url>', 'LLM Wiki API base URL', 'http://127.0.0.1:19828/api/v1')
  .option('--project-id <id>', 'LLM Wiki project id; defaults to target project .llm-wiki/project.json')
  .action(async (options: OnceOptions) => {
    try {
      const sourceRoot = path.resolve(expandHome(options.source));
      const targetRoot = path.resolve(expandHome(options.target));
      const statePath = path.resolve(expandHome(options.state ?? defaultStatePath(sourceRoot)));
      const ignorePath = options.ignore ? path.resolve(expandHome(options.ignore)) : undefined;
      const result = await applyKnowledgeSync({
        sourceRoot,
        targetRoot,
        statePath,
        ignorePath,
        apply: Boolean(options.apply),
      });

      printResult(result.actions, result.summary, Boolean(options.apply));

      if (options.apply && options.rescan !== false) {
        const projectId = options.projectId ?? (await readProjectIdFromTarget(targetRoot));
        if (projectId) {
          await triggerRescan(options.apiBase, projectId);
          process.stdout.write(`rescan: requested for project ${projectId}\n`);
        } else {
          process.stderr.write('rescan: skipped; could not resolve project id\n');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);

function printResult(
  actions: Array<{ kind: string; relativePath: string; reason: string }>,
  summary: { copied: number; deleted: number; skipped: number },
  apply: boolean
): void {
  process.stdout.write(`${apply ? 'apply' : 'dry-run'}: copy=${summary.copied} delete=${summary.deleted} skip=${summary.skipped}\n`);
  for (const action of actions) {
    const mark = action.kind === 'copy' ? '+' : '-';
    process.stdout.write(`  ${mark} ${action.relativePath} (${action.reason})\n`);
  }
}

function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input;
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '', input.slice(2));
  return input;
}

async function readProjectIdFromTarget(targetRoot: string): Promise<string | undefined> {
  const projectRoot = path.resolve(targetRoot, '..', '..', '..');
  try {
    const raw = await fs.readFile(path.join(projectRoot, '.llm-wiki', 'project.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id;
  } catch {
    return undefined;
  }
}

async function triggerRescan(apiBase: string, projectId: string): Promise<void> {
  const url = `${apiBase.replace(/\/$/, '')}/projects/${encodeURIComponent(projectId)}/sources/rescan`;
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`rescan failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
  }
}
