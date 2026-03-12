export type EditorName = 'vscode' | 'cursor' | 'trae';

export interface EditorPaths {
  settings: string;
  keybindings: string;
  extensions: string;
}

export interface EditorsConfig {
  vscode: EditorPaths;
  cursor: EditorPaths;
  trae: EditorPaths;
}

export interface KeybindingItem {
  key: string;
  command: string;
  when?: string;
  [key: string]: unknown;
}

export interface SyncState {
  settings: Record<string, unknown>;
  keybindings: KeybindingItem[];
  extensions: string[];
}

export type ConflictType = 'settings' | 'keybindings' | 'extensions';
export type ConflictChoice = EditorName | 'custom';

export interface ConflictEntry {
  type: ConflictType;
  id: string;
  candidates: Record<EditorName, unknown>;
  status: 'pending' | 'resolved';
  chosen?: ConflictChoice;
  customValue?: unknown;
}

export interface ConflictReport {
  generatedAt: string;
  conflicts: ConflictEntry[];
}

export interface MergeDomainInput {
  type: ConflictType;
  baseline: Record<string, unknown>;
  current: Record<EditorName, Record<string, unknown>>;
}

export interface MergeDomainResult {
  resolved: Record<string, unknown>;
  conflicts: ConflictEntry[];
}
