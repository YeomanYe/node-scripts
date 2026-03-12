import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readEditorState } from '../../src/sync-editor/io';

describe('sync-editor io JSONC support', () => {
  it('reads settings/keybindings with comments and trailing commas', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-io-'));
    const settingsPath = path.join(root, 'settings.json');
    const keybindingsPath = path.join(root, 'keybindings.json');
    const extensionsPath = path.join(root, 'extensions.json');

    await fs.writeFile(
      settingsPath,
      `{
  // comment
  "editor.fontSize": 16,
  "editor.tabSize": 2,
}
`,
      'utf-8'
    );

    await fs.writeFile(
      keybindingsPath,
      `// header comment
[
  {
    "key": "cmd+l",
    "command": "editor.action.insertSnippet",
  },
]
`,
      'utf-8'
    );

    await fs.writeFile(extensionsPath, '["ms-python.python"]\n', 'utf-8');

    const state = await readEditorState({
      settings: settingsPath,
      keybindings: keybindingsPath,
      extensions: extensionsPath,
    });

    expect(state.settings['editor.fontSize']).toBe(16);
    expect(state.settings['editor.tabSize']).toBe(2);
    expect(state.keybindings).toHaveLength(1);
    expect(state.keybindings[0].key).toBe('cmd+l');
    expect(state.extensions).toEqual(['ms-python.python']);
  });
});
