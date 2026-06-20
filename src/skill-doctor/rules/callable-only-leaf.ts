import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

// 叶子 skill:只被 flow-* / director-* 编排器调用,不应根据场景关键词自主触发
// (trigger 分层约定)。它们的 description 必须带 callable-only marker,防止以后被
// 改回"自动触发广告"。新增叶子 skill 时把名字加进本集合。
const LEAF_SKILLS = new Set<string>([
  'change-recap',
  'clean-commit',
  'delivery-gate',
  'ext-preflight',
  'skill-behavior-test',
  'skill-integration-test',
  'sync-skills',
  'project-prep',
  'web-image',
]);

const MARKER = /callable-only/;
const NO_AUTOTRIGGER = /不要根据场景关键词自动触发/;

export const callableOnlyLeafRule: Rule = {
  id: 'callable-only-leaf',
  description:
    'Leaf skills (orchestrator-invoked only) must declare callable-only in their description',
  async run(ctx) {
    const findings: Finding[] = [];

    for (const skill of ctx.skills) {
      if (!LEAF_SKILLS.has(skill.name)) continue;

      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const rel = path.relative(ctx.root, skill.skillMdPath);
      if (!MARKER.test(src) || !NO_AUTOTRIGGER.test(src)) {
        findings.push({
          rule: 'callable-only-leaf',
          level: 'warn',
          skill: skill.name,
          file: rel,
          message:
            'Leaf skill 应在 description 声明 callable-only（含 "[callable-only …]" + "不要根据场景关键词自动触发"），防止漂回自动触发',
        });
      }
    }

    return findings;
  },
};
