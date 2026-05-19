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

export interface FixerContext {
  root: string;
  skills: SkillEntry[];
}

export interface FixAction {
  fixer?: string;
  file: string;
  description: string;
  before?: string;
  after?: string;
}

export interface FixResult {
  fixer: string;
  actions: FixAction[];
  errors: string[];
}

export interface Fixer {
  id: string;
  description: string;
  fix: (ctx: FixerContext, dryRun: boolean) => Promise<FixResult>;
}

export interface RunReport {
  root: string;
  startedAt: string;
  durationMs: number;
  rulesRun: string[];
  findings: Finding[];
  counts: { error: number; warn: number; info: number };
  fix_mode?: 'dry-run' | 'apply';
  fixers_ran?: string[];
  fixes_pending?: FixAction[];
  fixes_applied?: FixAction[];
  fix_errors?: string[];
}
