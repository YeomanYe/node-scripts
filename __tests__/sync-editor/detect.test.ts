import { detectEditorConfigPaths } from '../../src/sync-editor/detect';

describe('detectEditorConfigPaths', () => {
  it('detects macOS paths', async () => {
    const exists = async (p: string) => p.includes('/Code/User') || p.includes('/Cursor/User') || p.includes('/Trae/User');

    const result = await detectEditorConfigPaths({
      platform: 'darwin',
      homeDir: '/Users/test',
      pathExists: exists,
    });

    expect(result.vscode.settings).toContain('/Users/test/Library/Application Support/Code/User/settings.json');
    expect(result.cursor.keybindings).toContain('/Users/test/Library/Application Support/Cursor/User/keybindings.json');
    expect(result.trae.settings).toContain('/Users/test/Library/Application Support/Trae/User/settings.json');
  });

  it('falls back to lowercase trae path on linux', async () => {
    const exists = async (p: string) => p.includes('/.config/Code/User') || p.includes('/.config/Cursor/User') || p.includes('/.config/trae/User');

    const result = await detectEditorConfigPaths({
      platform: 'linux',
      homeDir: '/home/test',
      pathExists: exists,
    });

    expect(result.trae.settings).toBe('/home/test/.config/trae/User/settings.json');
  });
});
