export type FindingLevel = 'error' | 'warn' | 'info';

export interface Finding {
  rule: string;
  level: FindingLevel;
  skill: string;
  file?: string;
  line?: number;
  message: string;
}

export interface RuleContext {
  root: string;
  skills: SkillEntry[];
}

export interface SkillEntry {
  name: string;
  dir: string;
  skillMdPath: string;
}

export interface Rule {
  id: string;
  description: string;
  run: (ctx: RuleContext) => Promise<Finding[]>;
}

export interface RunReport {
  root: string;
  startedAt: string;
  durationMs: number;
  rulesRun: string[];
  findings: Finding[];
  counts: { error: number; warn: number; info: number };
}
