import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { runInitCommand } from '../../src/sync-editor/init';

describe('runInitCommand', () => {
  it('creates editors-config.json with detected paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-init-'));
    const output = path.join(root, 'editors-config.json');

    const code = await runInitCommand(
      {
        outputPath: output,
        exportExtensions: false,
        extensionsDir: path.join(root, 'extensions'),
      },
      {
        detectPaths: async () => ({
          vscode: {
            settings: '/tmp/vscode/settings.json',
            keybindings: '/tmp/vscode/keybindings.json',
            extensions: '/tmp/ext/vscode-extensions.json',
          },
          cursor: {
            settings: '/tmp/cursor/settings.json',
            keybindings: '/tmp/cursor/keybindings.json',
            extensions: '/tmp/ext/cursor-extensions.json',
          },
          trae: {
            settings: '/tmp/trae/settings.json',
            keybindings: '/tmp/trae/keybindings.json',
            extensions: '/tmp/ext/trae-extensions.json',
          },
        }),
      }
    );

    expect(code).toBe(0);
    const config = JSON.parse(await fs.readFile(output, 'utf-8')) as Record<string, unknown>;
    expect(config.vscode).toBeDefined();
    expect(config.cursor).toBeDefined();
    expect(config.trae).toBeDefined();
  });

  it('exports extensions when enabled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-init-'));
    const output = path.join(root, 'editors-config.json');

    let exported = 0;
    const code = await runInitCommand(
      {
        outputPath: output,
        exportExtensions: true,
        extensionsDir: path.join(root, 'extensions'),
      },
      {
        detectPaths: async () => ({
          vscode: {
            settings: '/tmp/vscode/settings.json',
            keybindings: '/tmp/vscode/keybindings.json',
            extensions: path.join(root, 'extensions/vscode-extensions.json'),
          },
          cursor: {
            settings: '/tmp/cursor/settings.json',
            keybindings: '/tmp/cursor/keybindings.json',
            extensions: path.join(root, 'extensions/cursor-extensions.json'),
          },
          trae: {
            settings: '/tmp/trae/settings.json',
            keybindings: '/tmp/trae/keybindings.json',
            extensions: path.join(root, 'extensions/trae-extensions.json'),
          },
        }),
        exportExtensionsByCli: async () => {
          exported += 1;
          return { success: true };
        },
      }
    );

    expect(code).toBe(0);
    expect(exported).toBe(3);
  });
});
