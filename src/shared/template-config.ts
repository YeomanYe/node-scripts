import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type TemplateVariables = Record<string, string>;

interface CcConnectProject {
  name?: string;
  platforms: Array<{
    type?: string;
    options: Record<string, string>;
  }>;
}

interface CcConnectVariableSource {
  source: 'cc-connect';
  key: string;
  project?: string;
  platform?: string;
  config_path?: string;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function parseTomlString(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (/^[A-Za-z0-9_.:/@+\-]+$/.test(trimmed)) return trimmed;
  return undefined;
}

function parseCcConnectProjects(content: string): CcConnectProject[] {
  const projects: CcConnectProject[] = [];
  let currentProject: CcConnectProject | undefined;
  let currentPlatform: CcConnectProject['platforms'][number] | undefined;
  let section: 'project' | 'platform' | 'platformOptions' | 'other' = 'other';

  for (const line of content.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, '').trim();
    if (!withoutComment) continue;

    if (withoutComment === '[[projects]]') {
      currentProject = { platforms: [] };
      projects.push(currentProject);
      currentPlatform = undefined;
      section = 'project';
      continue;
    }
    if (withoutComment === '[[projects.platforms]]') {
      if (!currentProject) continue;
      currentPlatform = { options: {} };
      currentProject.platforms.push(currentPlatform);
      section = 'platform';
      continue;
    }
    if (withoutComment === '[projects.platforms.options]') {
      section = currentPlatform ? 'platformOptions' : 'other';
      continue;
    }
    if (withoutComment.startsWith('[')) {
      section = 'other';
      continue;
    }

    const match = withoutComment.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const value = parseTomlString(match[2]);
    if (value === undefined) continue;

    if (section === 'project' && currentProject && match[1] === 'name') {
      currentProject.name = value;
    } else if (section === 'platform' && currentPlatform && match[1] === 'type') {
      currentPlatform.type = value;
    } else if (section === 'platformOptions' && currentPlatform) {
      currentPlatform.options[match[1]] = value;
    }
  }

  return projects;
}

function readCcConnectVariable(source: CcConnectVariableSource): string {
  const configPath = source.config_path
    ? path.resolve(source.config_path)
    : path.join(os.homedir(), '.cc-connect', 'config.toml');
  const projects = parseCcConnectProjects(fs.readFileSync(configPath, 'utf-8'));
  const platformName = source.platform ?? 'feishu';
  const candidates = projects
    .filter((project) => !source.project || project.name === source.project)
    .flatMap((project) => project.platforms)
    .filter((platform) => platform.type === platformName);

  if (candidates.length === 0) {
    const projectLabel = source.project ? ` project=${source.project}` : '';
    throw new Error(`cc-connect${projectLabel} platform=${platformName} not found`);
  }
  if (!source.project && candidates.length > 1) {
    throw new Error('cc-connect has multiple matching platforms; set variables.*.project');
  }

  const value = candidates[0].options[source.key];
  if (!value) {
    throw new Error(`cc-connect platform=${platformName} missing option: ${source.key}`);
  }
  return value;
}

function parseVariableValue(raw: unknown, name: string): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (isRecord(raw) && raw.source === 'cc-connect') {
    if (typeof raw.key !== 'string' || !raw.key) {
      throw new Error(`variables.${name}.key must be a non-empty string`);
    }
    return readCcConnectVariable({
      source: 'cc-connect',
      key: raw.key,
      project: typeof raw.project === 'string' ? raw.project : undefined,
      platform: typeof raw.platform === 'string' ? raw.platform : undefined,
      config_path: typeof raw.config_path === 'string' ? raw.config_path : undefined,
    });
  }
  throw new Error(`variables.${name} must be a string, number, boolean, or cc-connect source`);
}

export function collectTemplateVariables(parsed: unknown): TemplateVariables {
  if (!isRecord(parsed) || parsed.variables === undefined) return {};
  if (!isRecord(parsed.variables)) throw new Error('"variables" must be an object');

  const result: TemplateVariables = {};
  for (const [name, value] of Object.entries(parsed.variables)) {
    result[name] = parseVariableValue(value, name);
  }
  return result;
}

export function renderTemplateString(input: string, variables: TemplateVariables): string {
  return input.replace(/\$\{([A-Za-z0-9_.-]+)\}|\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, dollarName, braceName) => {
    const name = dollarName ?? braceName;
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name];
    }
    return match;
  });
}

export function renderTemplates<T>(raw: T, variables: TemplateVariables): T {
  if (typeof raw === 'string') return renderTemplateString(raw, variables) as T;
  if (Array.isArray(raw)) return raw.map((item) => renderTemplates(item, variables)) as T;
  if (isRecord(raw)) {
    const rendered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      rendered[key] = key === 'variables' ? value : renderTemplates(value, variables);
    }
    return rendered as T;
  }
  return raw;
}
