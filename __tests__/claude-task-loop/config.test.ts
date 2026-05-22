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

  it('replaces template variables in config strings and prompt files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-loop-'));
    fs.writeFileSync(path.join(dir, 'task.md'), 'run ${slug} in {{repo}}\n', 'utf-8');
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        variables: {
          slug: 'stage1',
          repo: '/tmp/project',
          app_id: 'app-from-vars',
        },
        defaults: {
          workdir: '{{repo}}',
        },
        tasks: [
          {
            name: 'task-${slug}',
            prompt_file: 'task.md',
          },
        ],
        feishu: {
          app_id: '${app_id}',
          app_secret: 'secret',
          receive_id: 'chat',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(file);

    expect(config.defaults?.workdir).toBe('/tmp/project');
    expect(config.tasks[0]).toMatchObject({
      name: 'task-stage1',
      prompt: 'run stage1 in /tmp/project\n',
    });
    expect(config.feishu?.app_id).toBe('app-from-vars');
  });

  it('loads variables from cc-connect feishu platform config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-loop-'));
    const ccConfig = path.join(dir, 'cc-connect.toml');
    fs.writeFileSync(
      ccConfig,
      [
        '[[projects]]',
        'name = "projects"',
        '[[projects.platforms]]',
        'type = "feishu"',
        '[projects.platforms.options]',
        'app_id = "cli_from_cc"',
        'app_secret = "secret_from_cc"',
      ].join('\n'),
      'utf-8'
    );
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        variables: {
          feishu_app_id: {
            source: 'cc-connect',
            config_path: ccConfig,
            project: 'projects',
            platform: 'feishu',
            key: 'app_id',
          },
          feishu_app_secret: {
            source: 'cc-connect',
            config_path: ccConfig,
            project: 'projects',
            platform: 'feishu',
            key: 'app_secret',
          },
        },
        tasks: [{ prompt: 'hello' }],
        feishu: {
          app_id: '${feishu_app_id}',
          app_secret: '${feishu_app_secret}',
          receive_id: 'chat',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(file);

    expect(config.feishu).toMatchObject({
      app_id: 'cli_from_cc',
      app_secret: 'secret_from_cc',
    });
  });
});
