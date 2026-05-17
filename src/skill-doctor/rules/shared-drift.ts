import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

async function sha256OfFile(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

async function listSharedFiles(sharedDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sharedDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export const sharedDriftRule: Rule = {
  id: 'shared-drift',
  description: 'Detect hash drift between _shared/X.md and <skill>/references/X.md',
  async run(ctx) {
    const findings: Finding[] = [];
    const sharedDir = path.join(ctx.root, '_shared');
    const sharedFiles = await listSharedFiles(sharedDir);
    if (sharedFiles.length === 0) return findings;

    for (const fileName of sharedFiles) {
      const sharedHash = await sha256OfFile(path.join(sharedDir, fileName));
      if (!sharedHash) continue;
      for (const skill of ctx.skills) {
        const refPath = path.join(skill.dir, 'references', fileName);
        const refHash = await sha256OfFile(refPath);
        if (refHash === null) continue;
        if (refHash !== sharedHash) {
          findings.push({
            rule: 'shared-drift',
            level: 'warn',
            skill: skill.name,
            file: path.relative(ctx.root, refPath),
            message: `drift: ${fileName} sha256 differs from _shared/${fileName} (sync needed)`,
          });
        }
      }
    }
    return findings;
  },
};
