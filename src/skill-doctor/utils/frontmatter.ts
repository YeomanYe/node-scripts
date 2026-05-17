import { parse as parseYaml } from 'yaml';

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = '---';

export function parseFrontmatter(src: string): FrontmatterResult {
  if (!src.startsWith(`${FENCE}\n`) && !src.startsWith(`${FENCE}\r\n`)) {
    return { data: {}, body: src };
  }

  const rest = src.slice(FENCE.length).replace(/^\r?\n/, '');
  const closeIdx = rest.indexOf(`\n${FENCE}`);
  if (closeIdx === -1) return { data: {}, body: src };

  const yaml = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + FENCE.length + 1).replace(/^\r?\n/, '');
  try {
    const data = parseYaml(yaml) as Record<string, unknown> | null;
    return { data: data ?? {}, body };
  } catch {
    return { data: {}, body: src };
  }
}
