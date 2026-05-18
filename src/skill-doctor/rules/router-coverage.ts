import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

const ROUTER_REL = 'flow-codex-goal/references/role-router.md';

export const routerCoverageRule: Rule = {
  id: 'router-coverage',
  description: 'Ensure flow-codex-goal role-router mentions all director-* skills',
  async run(ctx) {
    const findings: Finding[] = [];
    const routerPath = path.join(ctx.root, ROUTER_REL);

    let routerSrc: string;
    try {
      routerSrc = await fs.readFile(routerPath, 'utf8');
    } catch {
      return findings;
    }

    for (const skill of ctx.skills) {
      if (!skill.name.startsWith('director-')) continue;
      if (routerSrc.includes(skill.name)) continue;

      findings.push({
        rule: 'router-coverage',
        level: 'warn',
        skill: skill.name,
        file: ROUTER_REL,
        message: `${skill.name} not found in ${ROUTER_REL} (router coverage gap)`,
      });
    }

    return findings;
  },
};
