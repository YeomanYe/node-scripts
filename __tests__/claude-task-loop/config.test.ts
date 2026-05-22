import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/claude-task-loop';

function writeTempConfig(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-loop-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('claude-task-loop config', () => {
  it('loads JSON object config', () => {
    const file = writeTempConfig(JSON.stringify({
      defaults: {
        workdir: '/tmp/project',
        model: 'sonnet',
        max_budget: 2,
        timeout_minutes: 20,
        permission_mode: 'bypassPermissions',
      },
      tasks: [
        {
          name: 'mode-probe',
          prompt: 'hello',
          max_budget: 1,
          permission_mode: 'plan',
        },
      ],
      feishu: {
        app_id: 'app',
        app_secret: 'secret',
        receive_id: 'chat',
      },
    }));

    const config = loadConfig(file);

    expect(config.defaults).toEqual({
      workdir: '/tmp/project',
      model: 'sonnet',
      max_budget: 2,
      timeout_minutes: 20,
      permission_mode: 'bypassPermissions',
    });
    expect(config.tasks).toEqual([
      {
        name: 'mode-probe',
        prompt: 'hello',
        prompt_file: undefined,
        workdir: undefined,
        model: undefined,
        max_budget: 1,
        permission_mode: 'plan',
      },
    ]);
    expect(config.feishu).toMatchObject({
      type: 'feishu',
      app_id: 'app',
      app_secret: 'secret',
      receive_id: 'chat',
      receive_id_type: 'chat_id',
    });
  });

  it('loads task prompt from prompt_file relative to config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-loop-'));
    fs.mkdirSync(path.join(dir, 'prompts'));
    fs.writeFileSync(path.join(dir, 'prompts', 'task.txt'), 'from file\n', 'utf-8');
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        tasks: [
          {
            name: 'file-prompt',
            prompt_file: 'prompts/task.txt',
          },
        ],
      }),
      'utf-8'
    );

    const config = loadConfig(file);

    expect(config.tasks[0]).toMatchObject({
      name: 'file-prompt',
      prompt: 'from file\n',
      prompt_file: 'prompts/task.txt',
    });
  });
});
