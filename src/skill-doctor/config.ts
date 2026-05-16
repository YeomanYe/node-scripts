import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import type { FeishuChannelConfig } from '../shared/notifiers/types';

const FeishuSchema = z.object({
  type: z.literal('feishu'),
  app_id: z.string(),
  app_secret: z.string(),
  receive_id: z.string(),
  receive_id_type: z.enum(['chat_id', 'open_id', 'user_id', 'email']).optional(),
  domain: z.string().optional(),
});

export function defaultFeishuPath(): string {
  return path.join(os.homedir(), '.config', 'skill-doctor', 'feishu.json');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadFeishuConfig(
  cliPath?: string,
  envVar = 'SKILL_DOCTOR_FEISHU_CONFIG',
  fallback = defaultFeishuPath(),
): Promise<FeishuChannelConfig | null> {
  const candidates = [cliPath, process.env[envVar], fallback].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (!await fileExists(candidate)) continue;
    const raw = await fs.readFile(candidate, 'utf8');
    return FeishuSchema.parse(JSON.parse(raw));
  }
  return null;
}
