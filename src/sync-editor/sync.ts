import { mergeDomain } from './merge';
import {
  ConflictEntry,
  ConflictType,
  EditorName,
  EditorsConfig,
  KeybindingItem,
  SyncState,
} from './types';
import {
  readEditorState,
  readEditorsConfig,
  readJsonFileOrDefault,
  writeEditorState,
  writeJsonFile,
} from './io';
import { InstallExtensionResult, installExtensionWithCli } from './install';

const EDITORS: EditorName[] = ['vscode', 'cursor', 'trae'];

interface SyncOptions {
  editorsConfigPath: string;
  baselinePath: string;
  conflictsPath: string;
  useEditor?: EditorName;
  installExtension?: (editor: EditorName, extensionId: string) => Promise<InstallExtensionResult>;
}

interface SyncMaps {
  settings: Record<string, unknown>;
  keybindings: Record<string, unknown>;
  extensions: Record<string, unknown>;
}

function keybindingId(item: KeybindingItem): string {
  const when = typeof item.when === 'string' ? item.when : '';
  return `${item.key}::${item.command}::${when}`;
}

function toKeybindingMap(items: KeybindingItem[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    result[keybindingId(item)] = item;
  }
  return result;
}

function toExtensionsMap(items: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    result[item] = true;
  }
  return result;
}

function fromSettingsMap(map: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function fromKeybindingsMap(map: Record<string, unknown>): KeybindingItem[] {
  return Object.keys(map)
    .filter((id) => map[id] !== undefined)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => map[id] as KeybindingItem);
}

function fromExtensionsMap(map: Record<string, unknown>): string[] {
  return Object.keys(map)
    .filter((id) => Boolean(map[id]))
    .sort((a, b) => a.localeCompare(b));
}

function stateToMaps(state: SyncState): SyncMaps {
  return {
    settings: { ...state.settings },
    keybindings: toKeybindingMap(state.keybindings),
    extensions: toExtensionsMap(state.extensions),
  };
}

function baselineToMaps(state: SyncState): SyncMaps {
  return stateToMaps(state);
}

function applyResolved(
  current: Record<string, unknown>,
  resolved: Record<string, unknown>,
  conflicts: ConflictEntry[],
  type: ConflictType
): Record<string, unknown> {
  const conflictIds = new Set(conflicts.filter((x) => x.type === type).map((x) => x.id));
  const next = { ...current };

  for (const [id, value] of Object.entries(resolved)) {
    if (conflictIds.has(id)) continue;

    if (value === undefined) {
      delete next[id];
    } else {
      next[id] = value;
    }
  }

  return next;
}

function mapsToState(maps: SyncMaps): SyncState {
  return {
    settings: fromSettingsMap(maps.settings),
    keybindings: fromKeybindingsMap(maps.keybindings),
    extensions: fromExtensionsMap(maps.extensions),
  };
}

async function readAllStates(config: EditorsConfig): Promise<Record<EditorName, SyncState>> {
  const vscode = await readEditorState(config.vscode);
  const cursor = await readEditorState(config.cursor);
  const trae = await readEditorState(config.trae);

  return { vscode, cursor, trae };
}

async function runSingleSourceSync(
  source: EditorName,
  states: Record<EditorName, SyncState>,
  config: EditorsConfig,
  baselinePath: string,
  installExtension: (editor: EditorName, extensionId: string) => Promise<InstallExtensionResult>
): Promise<number> {
  const sourceState = states[source];
  const sourceExtensions = new Set(sourceState.extensions);

  for (const editor of EDITORS) {
    if (editor !== source) {
      const installed = new Set(states[editor].extensions);
      const missing = [...sourceExtensions].filter((ext) => !installed.has(ext)).sort((a, b) => a.localeCompare(b));

      for (const extensionId of missing) {
        const result = await installExtension(editor, extensionId);
        if (!result.success && result.warning) {
          console.warn(result.warning);
        }
      }
    }

    await writeEditorState(config[editor], sourceState);
  }

  await writeJsonFile(baselinePath, sourceState);
  return 0;
}

export async function runSyncCommand(options: SyncOptions): Promise<number> {
  const editorsConfig = await readEditorsConfig(options.editorsConfigPath);
  const states = await readAllStates(editorsConfig);

  if (options.useEditor) {
    if (!EDITORS.includes(options.useEditor)) {
      throw new Error(`Invalid editor for -u: ${options.useEditor}`);
    }

    const installer = options.installExtension ?? installExtensionWithCli;
    return runSingleSourceSync(options.useEditor, states, editorsConfig, options.baselinePath, installer);
  }

  const baselineState = await readJsonFileOrDefault<SyncState>(options.baselinePath, {
    settings: {},
    keybindings: [],
    extensions: [],
  });
  const baselineMaps = baselineToMaps(baselineState);

  const currentMaps: Record<EditorName, SyncMaps> = {
    vscode: stateToMaps(states.vscode),
    cursor: stateToMaps(states.cursor),
    trae: stateToMaps(states.trae),
  };

  const settingsMerged = mergeDomain({
    type: 'settings',
    baseline: baselineMaps.settings,
    current: {
      vscode: currentMaps.vscode.settings,
      cursor: currentMaps.cursor.settings,
      trae: currentMaps.trae.settings,
    },
  });

  const keybindingsMerged = mergeDomain({
    type: 'keybindings',
    baseline: baselineMaps.keybindings,
    current: {
      vscode: currentMaps.vscode.keybindings,
      cursor: currentMaps.cursor.keybindings,
      trae: currentMaps.trae.keybindings,
    },
  });

  const extensionsMerged = mergeDomain({
    type: 'extensions',
    baseline: baselineMaps.extensions,
    current: {
      vscode: currentMaps.vscode.extensions,
      cursor: currentMaps.cursor.extensions,
      trae: currentMaps.trae.extensions,
    },
  });

  const conflicts = [
    ...settingsMerged.conflicts,
    ...keybindingsMerged.conflicts,
    ...extensionsMerged.conflicts,
  ];

  for (const editor of EDITORS) {
    const merged: SyncMaps = {
      settings: applyResolved(currentMaps[editor].settings, settingsMerged.resolved, conflicts, 'settings'),
      keybindings: applyResolved(currentMaps[editor].keybindings, keybindingsMerged.resolved, conflicts, 'keybindings'),
      extensions: applyResolved(currentMaps[editor].extensions, extensionsMerged.resolved, conflicts, 'extensions'),
    };

    const nextState = mapsToState(merged);
    await writeEditorState(editorsConfig[editor], nextState);
  }

  if (conflicts.length > 0) {
    await writeJsonFile(options.conflictsPath, {
      generatedAt: new Date().toISOString(),
      conflicts,
    });
    return 2;
  }

  const mergedState = await readEditorState(editorsConfig.vscode);
  await writeJsonFile(options.baselinePath, mergedState);
  return 0;
}
