import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exportEditorExtensions } from '../../src/sync-editor/extensions';

describe('exportEditorExtensions', () => {
  it('exports list from cli output to json file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exts-'));
    const output = path.join(root, 'vscode-extensions.json');

    const result = await exportEditorExtensions({
      cli: 'code',
      outputPath: output,
      runCommand: async () => 'ms-python.python\nesbenp.prettier-vscode\n',
    });

    expect(result.success).toBe(true);

    const content = JSON.parse(await fs.readFile(output, 'utf-8')) as string[];
    expect(content).toEqual(['esbenp.prettier-vscode', 'ms-python.python']);
  });

  it('returns warning when cli command fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exts-'));
    const output = path.join(root, 'cursor-extensions.json');

    const result = await exportEditorExtensions({
      cli: 'cursor',
      outputPath: output,
      runCommand: async () => {
        throw new Error('command not found');
      },
    });

    expect(result.success).toBe(false);
    expect(result.warning).toContain('cursor');
  });
});
