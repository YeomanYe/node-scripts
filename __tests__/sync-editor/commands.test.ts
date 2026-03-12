import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runSyncCommand } from '../../src/sync-editor/sync';
import { runResolveCommand } from '../../src/sync-editor/resolve';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

describe('sync-editor commands', () => {
  it('sync generates conflicts file and returns 2 when conflict exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-editor-'));

    const configPath = path.join(root, 'editors.json');
    const baselinePath = path.join(root, 'local', 'sync-editor', 'last-sync-state.json');
    const conflictsPath = path.join(root, 'local', 'sync-editor', 'conflicts.json');

    const vscodeSettings = path.join(root, 'vscode-settings.json');
    const cursorSettings = path.join(root, 'cursor-settings.json');
    const traeSettings = path.join(root, 'trae-settings.json');

    const vscodeKeybindings = path.join(root, 'vscode-keybindings.json');
    const cursorKeybindings = path.join(root, 'cursor-keybindings.json');
    const traeKeybindings = path.join(root, 'trae-keybindings.json');

    const vscodeExtensions = path.join(root, 'vscode-extensions.json');
    const cursorExtensions = path.join(root, 'cursor-extensions.json');
    const traeExtensions = path.join(root, 'trae-extensions.json');

    await writeJson(configPath, {
      vscode: { settings: vscodeSettings, keybindings: vscodeKeybindings, extensions: vscodeExtensions },
      cursor: { settings: cursorSettings, keybindings: cursorKeybindings, extensions: cursorExtensions },
      trae: { settings: traeSettings, keybindings: traeKeybindings, extensions: traeExtensions },
    });

    await writeJson(baselinePath, {
      settings: { 'workbench.colorTheme': 'Default Light+' },
      keybindings: [],
      extensions: [],
    });

    await writeJson(vscodeSettings, { 'workbench.colorTheme': 'Monokai' });
    await writeJson(cursorSettings, { 'workbench.colorTheme': 'Solarized Dark' });
    await writeJson(traeSettings, { 'workbench.colorTheme': 'Default Light+' });

    await writeJson(vscodeKeybindings, []);
    await writeJson(cursorKeybindings, []);
    await writeJson(traeKeybindings, []);

    await writeJson(vscodeExtensions, []);
    await writeJson(cursorExtensions, []);
    await writeJson(traeExtensions, []);

    const code = await runSyncCommand({
      editorsConfigPath: configPath,
      baselinePath,
      conflictsPath,
    });

    expect(code).toBe(2);
    const conflicts = await readJson<{ conflicts: Array<{ id: string }> }>(conflictsPath);
    expect(conflicts.conflicts).toHaveLength(1);
    expect(conflicts.conflicts[0].id).toBe('workbench.colorTheme');
  });

  it('resolve applies chosen values to all editors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-editor-'));

    const configPath = path.join(root, 'editors.json');
    const baselinePath = path.join(root, 'local', 'sync-editor', 'last-sync-state.json');
    const conflictsPath = path.join(root, 'local', 'sync-editor', 'conflicts.json');

    const vscodeSettings = path.join(root, 'vscode-settings.json');
    const cursorSettings = path.join(root, 'cursor-settings.json');
    const traeSettings = path.join(root, 'trae-settings.json');

    const vscodeKeybindings = path.join(root, 'vscode-keybindings.json');
    const cursorKeybindings = path.join(root, 'cursor-keybindings.json');
    const traeKeybindings = path.join(root, 'trae-keybindings.json');

    const vscodeExtensions = path.join(root, 'vscode-extensions.json');
    const cursorExtensions = path.join(root, 'cursor-extensions.json');
    const traeExtensions = path.join(root, 'trae-extensions.json');

    await writeJson(configPath, {
      vscode: { settings: vscodeSettings, keybindings: vscodeKeybindings, extensions: vscodeExtensions },
      cursor: { settings: cursorSettings, keybindings: cursorKeybindings, extensions: cursorExtensions },
      trae: { settings: traeSettings, keybindings: traeKeybindings, extensions: traeExtensions },
    });

    await writeJson(vscodeSettings, { 'editor.fontSize': 14 });
    await writeJson(cursorSettings, { 'editor.fontSize': 14 });
    await writeJson(traeSettings, { 'editor.fontSize': 14 });

    await writeJson(vscodeKeybindings, []);
    await writeJson(cursorKeybindings, []);
    await writeJson(traeKeybindings, []);

    await writeJson(vscodeExtensions, ['ms-python.python']);
    await writeJson(cursorExtensions, ['ms-python.python']);
    await writeJson(traeExtensions, ['ms-python.python']);

    await writeJson(conflictsPath, {
      conflicts: [
        {
          type: 'settings',
          id: 'editor.fontSize',
          status: 'resolved',
          chosen: 'custom',
          customValue: 16,
          candidates: {
            vscode: 14,
            cursor: 14,
            trae: 14,
          },
        },
      ],
    });

    const code = await runResolveCommand({
      editorsConfigPath: configPath,
      baselinePath,
      conflictsPath,
    });

    expect(code).toBe(0);

    const vscode = await readJson<Record<string, unknown>>(vscodeSettings);
    const cursor = await readJson<Record<string, unknown>>(cursorSettings);
    const trae = await readJson<Record<string, unknown>>(traeSettings);

    expect(vscode['editor.fontSize']).toBe(16);
    expect(cursor['editor.fontSize']).toBe(16);
    expect(trae['editor.fontSize']).toBe(16);

    const baseline = await readJson<{ settings: Record<string, unknown> }>(baselinePath);
    expect(baseline.settings['editor.fontSize']).toBe(16);
  });

  it('sync with -u uses source editor config and installs missing extensions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-editor-'));

    const configPath = path.join(root, 'editors.json');
    const baselinePath = path.join(root, 'local', 'sync-editor', 'last-sync-state.json');
    const conflictsPath = path.join(root, 'local', 'sync-editor', 'conflicts.json');

    const vscodeSettings = path.join(root, 'vscode-settings.json');
    const cursorSettings = path.join(root, 'cursor-settings.json');
    const traeSettings = path.join(root, 'trae-settings.json');

    const vscodeKeybindings = path.join(root, 'vscode-keybindings.json');
    const cursorKeybindings = path.join(root, 'cursor-keybindings.json');
    const traeKeybindings = path.join(root, 'trae-keybindings.json');

    const vscodeExtensions = path.join(root, 'vscode-extensions.json');
    const cursorExtensions = path.join(root, 'cursor-extensions.json');
    const traeExtensions = path.join(root, 'trae-extensions.json');

    await writeJson(configPath, {
      vscode: { settings: vscodeSettings, keybindings: vscodeKeybindings, extensions: vscodeExtensions },
      cursor: { settings: cursorSettings, keybindings: cursorKeybindings, extensions: cursorExtensions },
      trae: { settings: traeSettings, keybindings: traeKeybindings, extensions: traeExtensions },
    });

    await writeJson(vscodeSettings, { 'editor.fontSize': 18 });
    await writeJson(cursorSettings, { 'editor.fontSize': 12 });
    await writeJson(traeSettings, { 'editor.fontSize': 14 });

    await writeJson(vscodeKeybindings, [{ key: 'ctrl+j', command: 'workbench.action.togglePanel' }]);
    await writeJson(cursorKeybindings, []);
    await writeJson(traeKeybindings, []);

    await writeJson(vscodeExtensions, ['ms-python.python', 'esbenp.prettier-vscode']);
    await writeJson(cursorExtensions, ['ms-python.python']);
    await writeJson(traeExtensions, []);

    const installs: Array<{ editor: string; extensionId: string }> = [];
    const code = await runSyncCommand({
      editorsConfigPath: configPath,
      baselinePath,
      conflictsPath,
      useEditor: 'vscode',
      installExtension: async (editor, extensionId) => {
        installs.push({ editor, extensionId });
        return { success: true };
      },
    });

    expect(code).toBe(0);

    const cursorState = await readJson<Record<string, unknown>>(cursorSettings);
    const traeState = await readJson<Record<string, unknown>>(traeSettings);
    expect(cursorState['editor.fontSize']).toBe(18);
    expect(traeState['editor.fontSize']).toBe(18);

    const cursorExt = await readJson<string[]>(cursorExtensions);
    const traeExt = await readJson<string[]>(traeExtensions);
    expect(cursorExt).toEqual(['ms-python.python', 'esbenp.prettier-vscode']);
    expect(traeExt).toEqual(['ms-python.python', 'esbenp.prettier-vscode']);

    expect(installs).toEqual([
      { editor: 'cursor', extensionId: 'esbenp.prettier-vscode' },
      { editor: 'trae', extensionId: 'esbenp.prettier-vscode' },
      { editor: 'trae', extensionId: 'ms-python.python' },
    ]);
  });
});
