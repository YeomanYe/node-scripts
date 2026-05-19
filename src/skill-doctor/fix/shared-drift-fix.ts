import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import type { Fixer } from './types';

const execFileAsync = promisify(execFile);

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const sharedDriftFixer: Fixer = {
  id: 'shared-drift',
  description: 'Run scripts/sync-shared.sh through skill-doctor',
  async fix(ctx, dryRun) {
    const script = path.join(ctx.root, 'scripts', 'sync-shared.sh');
    const rel = 'scripts/sync-shared.sh';
    try {
      const stat = await fs.stat(script);
      if (!stat.isFile()) {
        return { fixer: 'shared-drift', actions: [], errors: ['no sync-shared.sh found'] };
      }
    } catch {
      return { fixer: 'shared-drift', actions: [], errors: ['no sync-shared.sh found'] };
    }

    if (dryRun) {
      return {
        fixer: 'shared-drift',
        actions: [{ file: rel, description: 'would run sync-shared.sh' }],
        errors: [],
      };
    }

    if (!await isExecutable(script)) {
      return { fixer: 'shared-drift', actions: [], errors: ['sync-shared.sh is not executable'] };
    }

    try {
      await execFileAsync('bash', [script], { cwd: ctx.root });
      return {
        fixer: 'shared-drift',
        actions: [{ file: rel, description: 'ran sync-shared.sh' }],
        errors: [],
      };
    } catch (err) {
      return {
        fixer: 'shared-drift',
        actions: [],
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  },
};
