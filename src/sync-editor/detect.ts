import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EditorsConfig } from './types';

export interface DetectOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  pathExists?: (filePath: string) => Promise<boolean>;
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildUserDir(platform: NodeJS.Platform, homeDir: string, appName: string): string {
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', appName, 'User');
  }
  return path.join(homeDir, '.config', appName, 'User');
}

async function pickUserDir(candidates: string[], exists: (filePath: string) => Promise<boolean>): Promise<string> {
  for (const dir of candidates) {
    const settings = path.join(dir, 'settings.json');
    const keybindings = path.join(dir, 'keybindings.json');
    if ((await exists(settings)) || (await exists(keybindings))) {
      return dir;
    }
  }

  return candidates[0];
}

export async function detectEditorConfigPaths(options: DetectOptions = {}): Promise<EditorsConfig> {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const exists = options.pathExists ?? defaultPathExists;

  const vscodeUserDir = await pickUserDir([buildUserDir(platform, homeDir, 'Code')], exists);
  const cursorUserDir = await pickUserDir([buildUserDir(platform, homeDir, 'Cursor')], exists);
  const traeUserDir = await pickUserDir(
    [buildUserDir(platform, homeDir, 'Trae'), buildUserDir(platform, homeDir, 'trae')],
    exists
  );

  const extensionsDir = path.join(homeDir, '.config', 'editor-sync');

  return {
    vscode: {
      settings: path.join(vscodeUserDir, 'settings.json'),
      keybindings: path.join(vscodeUserDir, 'keybindings.json'),
      extensions: path.join(extensionsDir, 'vscode-extensions.json'),
    },
    cursor: {
      settings: path.join(cursorUserDir, 'settings.json'),
      keybindings: path.join(cursorUserDir, 'keybindings.json'),
      extensions: path.join(extensionsDir, 'cursor-extensions.json'),
    },
    trae: {
      settings: path.join(traeUserDir, 'settings.json'),
      keybindings: path.join(traeUserDir, 'keybindings.json'),
      extensions: path.join(extensionsDir, 'trae-extensions.json'),
    },
  };
}
