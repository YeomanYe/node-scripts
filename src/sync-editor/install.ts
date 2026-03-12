import { execFile } from 'child_process';
import { promisify } from 'util';
import { EditorName } from './types';

const execFileAsync = promisify(execFile);

const CLI_BY_EDITOR: Record<EditorName, string> = {
  vscode: 'code',
  cursor: 'cursor',
  trae: 'trae',
};

export interface InstallExtensionResult {
  success: boolean;
  warning?: string;
}

export async function installExtensionWithCli(editor: EditorName, extensionId: string): Promise<InstallExtensionResult> {
  const cli = CLI_BY_EDITOR[editor];

  try {
    await execFileAsync(cli, ['--install-extension', extensionId]);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      warning: `Failed to install extension ${extensionId} for ${editor}: ${message}`,
    };
  }
}
