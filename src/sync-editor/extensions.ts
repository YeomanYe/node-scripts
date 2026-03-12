import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExportExtensionsOptions {
  cli: string;
  outputPath: string;
  runCommand?: (cli: string) => Promise<string>;
}

export interface ExportExtensionsResult {
  success: boolean;
  warning?: string;
}

async function defaultRunCommand(cli: string): Promise<string> {
  const { stdout } = await execFileAsync(cli, ['--list-extensions']);
  return stdout;
}

function normalizeExtensions(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export async function exportEditorExtensions(options: ExportExtensionsOptions): Promise<ExportExtensionsResult> {
  const runCommand = options.runCommand ?? defaultRunCommand;

  try {
    const raw = await runCommand(options.cli);
    const list = normalizeExtensions(raw);

    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(options.outputPath, `${JSON.stringify(list, null, 2)}\n`, 'utf-8');

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      warning: `Failed to export extensions with ${options.cli}: ${message}`,
    };
  }
}
