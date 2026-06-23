import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export const DEFAULT_ENV_FILE = '~/Documents/knowledge/local/.env';
export const DEFAULT_API_KEY_ENV = 'Z_API_KEY';

export function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    result[key] = unquote(normalized.slice(index + 1));
  }
  return result;
}

export async function loadDotEnv(filePath: string): Promise<Record<string, string>> {
  const resolved = path.resolve(expandHome(filePath));
  const content = await fs.readFile(resolved, 'utf-8');
  return parseDotEnv(content);
}

export async function readZaiApiKey(options: { envFile: string; apiKeyEnv: string }): Promise<string> {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = await loadDotEnv(options.envFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const value = fileValues[options.apiKeyEnv] ?? process.env[options.apiKeyEnv];
  if (!value || value.trim().length === 0) {
    throw new Error(`未找到 ${options.apiKeyEnv}，请检查 ${expandHome(options.envFile)} 或当前环境变量`);
  }
  return value.trim();
}
