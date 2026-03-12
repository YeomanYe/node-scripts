#!/usr/bin/env node

import { Command } from 'commander';
import { runInitCommand } from './init';
import { runResolveCommand } from './resolve';
import { runSyncCommand } from './sync';

const DEFAULT_BASELINE_PATH = 'local/sync-editor/last-sync-state.json';
const DEFAULT_CONFLICTS_PATH = 'local/sync-editor/conflicts.json';
const DEFAULT_EDITORS_CONFIG_PATH = 'local/sync-editor/editors-config.json';
const DEFAULT_EXTENSIONS_DIR = 'local/sync-editor/extensions';

const program = new Command();
program.name('sync-editor').description('Sync VSCode/Cursor/Trae settings, keybindings, and extensions').version('1.0.0');

program
  .command('init')
  .description('Auto-detect editor config paths and generate editors-config')
  .option('-o, --output <path>', 'Path to generated editors-config file', DEFAULT_EDITORS_CONFIG_PATH)
  .option('--no-export-extensions', 'Disable exporting extensions by calling editor CLIs')
  .option('--extensions-dir <path>', 'Directory to store exported extension list files', DEFAULT_EXTENSIONS_DIR)
  .action(async (options: { output: string; exportExtensions?: boolean; extensionsDir: string }) => {
    try {
      const code = await runInitCommand({
        outputPath: options.output,
        exportExtensions: Boolean(options.exportExtensions),
        extensionsDir: options.extensionsDir,
      });
      process.exitCode = code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

program
  .command('sync')
  .description('Run three-way sync and generate conflicts if needed')
  .option('-c, --editors-config <path>', 'Path to editors config JSON file', DEFAULT_EDITORS_CONFIG_PATH)
  .option('-b, --baseline <path>', 'Path to baseline state file', DEFAULT_BASELINE_PATH)
  .option('-o, --conflicts <path>', 'Path to conflicts report file', DEFAULT_CONFLICTS_PATH)
  .option('-u, --use <editor>', 'Use one editor as source: vscode|cursor|trae')
  .action(async (options: { editorsConfig: string; baseline: string; conflicts: string; use?: string }) => {
    try {
      const code = await runSyncCommand({
        editorsConfigPath: options.editorsConfig,
        baselinePath: options.baseline,
        conflictsPath: options.conflicts,
        useEditor: options.use as 'vscode' | 'cursor' | 'trae' | undefined,
      });
      process.exitCode = code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

program
  .command('resolve')
  .description('Apply resolved conflicts and update baseline')
  .option('-c, --editors-config <path>', 'Path to editors config JSON file', DEFAULT_EDITORS_CONFIG_PATH)
  .option('-f, --file <path>', 'Path to conflicts report file', DEFAULT_CONFLICTS_PATH)
  .option('-b, --baseline <path>', 'Path to baseline state file', DEFAULT_BASELINE_PATH)
  .action(async (options: { editorsConfig: string; baseline: string; file: string }) => {
    try {
      const code = await runResolveCommand({
        editorsConfigPath: options.editorsConfig,
        baselinePath: options.baseline,
        conflictsPath: options.file,
      });
      process.exitCode = code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
