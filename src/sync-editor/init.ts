import * as path from 'path';
import { detectEditorConfigPaths } from './detect';
import { exportEditorExtensions, ExportExtensionsResult } from './extensions';
import { writeJsonFile } from './io';
import { EditorsConfig, EditorName } from './types';

const EDITORS: Array<{ key: EditorName; cli: string }> = [
  { key: 'vscode', cli: 'code' },
  { key: 'cursor', cli: 'cursor' },
  { key: 'trae', cli: 'trae' },
];

export interface InitOptions {
  outputPath: string;
  exportExtensions: boolean;
  extensionsDir: string;
}

interface InitDeps {
  detectPaths?: () => Promise<EditorsConfig>;
  exportExtensionsByCli?: (options: { cli: string; outputPath: string }) => Promise<ExportExtensionsResult>;
}

function applyExtensionsDir(config: EditorsConfig, extensionsDir: string): EditorsConfig {
  return {
    vscode: { ...config.vscode, extensions: path.join(extensionsDir, 'vscode-extensions.json') },
    cursor: { ...config.cursor, extensions: path.join(extensionsDir, 'cursor-extensions.json') },
    trae: { ...config.trae, extensions: path.join(extensionsDir, 'trae-extensions.json') },
  };
}

export async function runInitCommand(options: InitOptions, deps: InitDeps = {}): Promise<number> {
  const detectPaths = deps.detectPaths ?? detectEditorConfigPaths;
  const exportByCli = deps.exportExtensionsByCli ?? (async ({ cli, outputPath }) => exportEditorExtensions({ cli, outputPath }));

  const detected = await detectPaths();
  const config = applyExtensionsDir(detected, options.extensionsDir);

  if (options.exportExtensions) {
    for (const editor of EDITORS) {
      const result = await exportByCli({
        cli: editor.cli,
        outputPath: config[editor.key].extensions,
      });

      if (!result.success && result.warning) {
        console.warn(result.warning);
      }
    }
  }

  await writeJsonFile(options.outputPath, config);
  return 0;
}
