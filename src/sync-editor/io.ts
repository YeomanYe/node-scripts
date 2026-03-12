import * as fs from 'fs/promises';
import * as path from 'path';
import { EditorsConfig, KeybindingItem, SyncState } from './types';

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseJsonWithComments<T>(content);
}

export async function readJsonFileOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export async function readEditorsConfig(filePath: string): Promise<EditorsConfig> {
  return readJsonFile<EditorsConfig>(filePath);
}

export async function readEditorState(config: EditorsConfig['vscode']): Promise<SyncState> {
  const settings = await readJsonFileOrDefault<Record<string, unknown>>(config.settings, {});
  const keybindings = await readJsonFileOrDefault<KeybindingItem[]>(config.keybindings, []);
  const extensions = await readJsonFileOrDefault<string[]>(config.extensions, []);

  return {
    settings,
    keybindings,
    extensions,
  };
}

export async function writeEditorState(config: EditorsConfig['vscode'], state: SyncState): Promise<void> {
  await writeJsonFile(config.settings, state.settings);
  await writeJsonFile(config.keybindings, state.keybindings);
  await writeJsonFile(config.extensions, state.extensions);
}

function parseJsonWithComments<T>(content: string): T {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const stripped = stripComments(withoutBom);
  const noTrailingCommas = stripTrailingCommas(stripped);
  return JSON.parse(noTrailingCommas) as T;
}

function stripComments(input: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let quoteChar = '"';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      inString = true;
      quoteChar = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') {
        i += 1;
      }
      if (i < input.length) {
        result += '\n';
      }
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        i += 1;
      }
      i += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function stripTrailingCommas(input: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let quoteChar = '"';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      inString = true;
      quoteChar = char;
      result += char;
      continue;
    }

    if (char === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) {
        j += 1;
      }
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        continue;
      }
    }

    result += char;
  }

  return result;
}
