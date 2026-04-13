import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { jwtDecode } from 'jwt-decode';
import { z } from 'zod';
import { LocalAuth } from './types';

const authFileSchema = z.object({
  auth_mode: z.string().nullable().optional(),
  OPENAI_API_KEY: z.string().nullable().optional(),
  tokens: z
    .object({
      id_token: z.string().optional(),
      access_token: z.string(),
      account_id: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const jwtClaimsSchema = z.object({
  'https://api.openai.com/auth': z
    .object({
      chatgpt_account_id: z.string().optional(),
      chatgpt_plan_type: z.string().optional(),
    })
    .optional(),
});

export function getDefaultAuthPath(): string {
  return join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'auth.json');
}

export async function loadLocalAuth(authFile = getDefaultAuthPath()): Promise<LocalAuth> {
  const content = await readFile(authFile, 'utf8');
  const parsed = authFileSchema.parse(JSON.parse(content));

  if (parsed.auth_mode === 'api_key' || parsed.OPENAI_API_KEY) {
    throw new Error('Local auth is not a ChatGPT login.');
  }

  if (!parsed.tokens) {
    throw new Error('Local ChatGPT auth is missing token data.');
  }

  const claims = parseChatGptClaims(parsed.tokens.id_token);
  const accountId = parsed.tokens.account_id ?? claims?.chatgpt_account_id;
  if (!accountId) {
    throw new Error('Local ChatGPT auth is missing chatgpt account id.');
  }

  return {
    accessToken: parsed.tokens.access_token,
    accountId,
    ...(claims?.chatgpt_plan_type ? { planType: claims.chatgpt_plan_type } : {}),
  };
}

function parseChatGptClaims(
  idToken?: string
): { chatgpt_account_id?: string; chatgpt_plan_type?: string } | null {
  if (!idToken) {
    return null;
  }

  try {
    const decoded = jwtClaimsSchema.safeParse(jwtDecode(idToken));
    return decoded.success ? decoded.data['https://api.openai.com/auth'] ?? null : null;
  } catch {
    return null;
  }
}
