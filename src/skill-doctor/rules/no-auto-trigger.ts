import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

// 不自动触发的 skill(trigger 分层):description 必须带通用不变量
// "不要根据场景关键词自动触发",防止以后被改回自动触发广告。
//
// 两类:
//   - 叶子 skill(只被编排器调用)→ marker `[callable-only · 由 X 编排调用]`
//   - 顶层工作流但非常用(显式点名才进)→ marker `[explicit-only · 显式点名才触发]`
// 两类 marker 前缀不同,但都含同一句"不要根据场景关键词自动触发",规则只校验这一句。
// 新增此类 skill 时把名字加进本集合。
const NO_AUTO_TRIGGER_SKILLS = new Set<string>([
  // 叶子(callable-only):只被 flow-* / director-* 编排器调用
  'change-recap',
  'clean-commit',
  'delivery-gate',
  'ext-preflight',
  'skill-behavior-test',
  'skill-integration-test',
  'sync-skills',
  'project-prep',
  'web-image',
  // 顶层工作流(explicit-only):非常用,显式点名才进
  'flow-cron',
  'flow-codex-goal',
  'flow-ext-publish',
  'flow-project-bootstrap',
  'flow-project-finish',
]);

const NO_AUTOTRIGGER_PHRASE = /不要根据场景关键词自动触发/;

export const noAutoTriggerRule: Rule = {
  id: 'no-auto-trigger',
  description:
    'Non-auto-trigger skills (leaf callable-only / explicit-only workflows) must declare "不要根据场景关键词自动触发" in their description',
  async run(ctx) {
    const findings: Finding[] = [];

    for (const skill of ctx.skills) {
      if (!NO_AUTO_TRIGGER_SKILLS.has(skill.name)) continue;

      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const rel = path.relative(ctx.root, skill.skillMdPath);
      if (!NO_AUTOTRIGGER_PHRASE.test(src)) {
        findings.push({
          rule: 'no-auto-trigger',
          level: 'warn',
          skill: skill.name,
          file: rel,
          message:
            'description 应声明 "不要根据场景关键词自动触发"（叶子用 [callable-only…] / 顶层工作流用 [explicit-only…]），防止漂回自动触发',
        });
      }
    }

    return findings;
  },
};
