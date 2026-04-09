import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Credentials, CredentialsFile } from './types';

const execFileAsync = promisify(execFile);

/**
 * 从 macOS 钥匙串读取凭证 JSON 字符串
 * @returns 凭证 JSON 字符串，失败时返回 null
 */
async function readFromKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 从文件系统读取凭证 JSON 字符串
 * @returns 凭证 JSON 字符串，失败时返回 null
 */
async function readFromFile(): Promise<string | null> {
  const credPath = path.join(
    process.env['HOME'] ?? '',
    '.claude',
    '.credentials.json'
  );
  try {
    const content = await fs.promises.readFile(credPath, 'utf-8');
    return content.trim();
  } catch {
    return null;
  }
}

/**
 * 验证并解析凭证对象
 * @param raw - 从 JSON 解析的未知数据
 * @returns 凭证信息
 */
export function parseCredentials(raw: unknown): Credentials {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('凭证格式无效：不是对象');
  }

  const obj = raw as Record<string, unknown>;
  const oauth = obj['claudeAiOauth'];

  if (typeof oauth !== 'object' || oauth === null) {
    throw new Error('凭证格式无效：缺少 claudeAiOauth');
  }

  const oauthObj = oauth as Record<string, unknown>;
  const accessToken = oauthObj['accessToken'];

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('凭证格式无效：缺少 accessToken');
  }

  const subscriptionType = typeof oauthObj['subscriptionType'] === 'string'
    ? oauthObj['subscriptionType']
    : 'unknown';
  const rateLimitTier = typeof oauthObj['rateLimitTier'] === 'string'
    ? oauthObj['rateLimitTier']
    : 'unknown';

  return {
    accessToken,
    subscriptionType,
    rateLimitTier,
  };
}

/**
 * 获取 Claude OAuth 凭证
 * 优先从 macOS 钥匙串读取，失败时从文件读取
 * @returns 凭证信息
 */
export async function getCredentials(): Promise<Credentials> {
  const jsonStr = (await readFromKeychain()) ?? (await readFromFile());

  if (!jsonStr) {
    throw new Error(
      '无法获取凭证：钥匙串和文件均不可用。请确保已登录 Claude Code。'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr) as unknown;
  } catch {
    throw new Error('凭证 JSON 解析失败');
  }

  return parseCredentials(parsed);
}
