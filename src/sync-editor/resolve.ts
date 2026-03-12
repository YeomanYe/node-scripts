import {
  ConflictChoice,
  ConflictEntry,
  EditorName,
  KeybindingItem,
  SyncState,
} from './types';
import {
  readEditorState,
  readEditorsConfig,
  readJsonFile,
  writeEditorState,
  writeJsonFile,
} from './io';

interface ResolveOptions {
  editorsConfigPath: string;
  baselinePath: string;
  conflictsPath: string;
}

function keybindingId(item: KeybindingItem): string {
  const when = typeof item.when === 'string' ? item.when : '';
  return `${item.key}::${item.command}::${when}`;
}

function pickValue(entry: ConflictEntry): unknown {
  if (entry.chosen === 'custom') {
    return entry.customValue;
  }

  if (!entry.chosen) {
    throw new Error(`Conflict ${entry.type}:${entry.id} missing chosen field`);
  }

  return entry.candidates[entry.chosen as EditorName];
}

function validateChoice(choice: ConflictChoice | undefined): void {
  if (!choice) {
    throw new Error('Conflict entry missing chosen');
  }

  if (!['vscode', 'cursor', 'trae', 'custom'].includes(choice)) {
    throw new Error(`Invalid chosen value: ${choice}`);
  }
}

function normalizeState(state: SyncState): SyncState {
  const settings: Record<string, unknown> = { ...state.settings };

  const keybindingsMap: Record<string, KeybindingItem> = {};
  for (const item of state.keybindings) {
    keybindingsMap[keybindingId(item)] = item;
  }

  const extensionsSet = new Set<string>(state.extensions);

  return {
    settings,
    keybindings: Object.keys(keybindingsMap)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => keybindingsMap[id]),
    extensions: Array.from(extensionsSet).sort((a, b) => a.localeCompare(b)),
  };
}

function applyConflict(state: SyncState, entry: ConflictEntry): SyncState {
  const next = normalizeState(state);
  const value = pickValue(entry);

  if (entry.type === 'settings') {
    if (value === undefined) {
      delete next.settings[entry.id];
    } else {
      next.settings[entry.id] = value;
    }
    return next;
  }

  if (entry.type === 'keybindings') {
    const map: Record<string, KeybindingItem> = {};
    for (const item of next.keybindings) {
      map[keybindingId(item)] = item;
    }

    if (value === undefined) {
      delete map[entry.id];
    } else {
      map[entry.id] = value as KeybindingItem;
    }

    next.keybindings = Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => map[id]);
    return next;
  }

  const set = new Set(next.extensions);
  if (Boolean(value)) {
    set.add(entry.id);
  } else {
    set.delete(entry.id);
  }
  next.extensions = Array.from(set).sort((a, b) => a.localeCompare(b));
  return next;
}

export async function runResolveCommand(options: ResolveOptions): Promise<number> {
  const editorsConfig = await readEditorsConfig(options.editorsConfigPath);
  const report = await readJsonFile<{ conflicts: ConflictEntry[] }>(options.conflictsPath);

  if (!Array.isArray(report.conflicts)) {
    throw new Error('Invalid conflicts file: conflicts should be an array');
  }

  const pending = report.conflicts.filter((entry) => entry.status !== 'resolved');
  if (pending.length > 0) {
    throw new Error(`There are still ${pending.length} pending conflicts`);
  }

  for (const entry of report.conflicts) {
    validateChoice(entry.chosen);
    if (entry.chosen === 'custom' && !Object.prototype.hasOwnProperty.call(entry, 'customValue')) {
      throw new Error(`Conflict ${entry.type}:${entry.id} chosen=custom requires customValue`);
    }
  }

  let vscode = normalizeState(await readEditorState(editorsConfig.vscode));
  let cursor = normalizeState(await readEditorState(editorsConfig.cursor));
  let trae = normalizeState(await readEditorState(editorsConfig.trae));

  for (const entry of report.conflicts) {
    vscode = applyConflict(vscode, entry);
    cursor = applyConflict(cursor, entry);
    trae = applyConflict(trae, entry);
  }

  await writeEditorState(editorsConfig.vscode, vscode);
  await writeEditorState(editorsConfig.cursor, cursor);
  await writeEditorState(editorsConfig.trae, trae);

  await writeJsonFile(options.baselinePath, vscode);
  return 0;
}
