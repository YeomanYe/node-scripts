import {
  collectGitSnapshot,
  collectTrackedMetadataRoots,
  detectChangedRepos,
  readConfigFromEnv,
  runCommand,
  runSkillshareSyncNotify,
  type GitSnapshot,
  type SkillshareSyncDeps,
} from '../../src/skillshare-sync-notify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

function createDeps(overrides: Partial<SkillshareSyncDeps> = {}): SkillshareSyncDeps {
  return {
    getSnapshot: jest.fn(async () => new Map()),
    runCommand: jest.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    notify: jest.fn(async () => undefined),
    log: jest.fn(),
    ...overrides,
  };
}

function snapshot(entries: Array<[string, string]>): GitSnapshot {
  return new Map(entries);
}

async function runGit(args: string[], cwd: string): Promise<number> {
  const result = await runCommand('git', args, cwd);
  return result.code;
}

describe('skillshare-sync-notify', () => {
  test('detectChangedRepos returns added and updated repo heads', () => {
    const before = snapshot([
      ['/skills/a', 'aaa'],
      ['/skills/b', 'bbb'],
    ]);
    const after = snapshot([
      ['/skills/a', 'aaa'],
      ['/skills/b', 'ccc'],
      ['/skills/c', 'ddd'],
    ]);

    expect(detectChangedRepos(before, after)).toEqual([
      { path: '/skills/b', before: 'bbb', after: 'ccc' },
      { path: '/skills/c', before: undefined, after: 'ddd' },
    ]);
  });

  test('runs skillshare sync and sends Feishu notification when updates are detected', async () => {
    const deps = createDeps({
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce(snapshot([['/skills/a', 'aaa']]))
        .mockResolvedValueOnce(snapshot([['/skills/a', 'bbb']])),
    });

    const result = await runSkillshareSyncNotify({
      skillshareRoot: '/tmp/skillshare',
      feishu: { type: 'feishu', app_id: 'cli_test', app_secret: 'secret', receive_id: 'chat' },
    }, deps);

    expect(result.status).toBe('updated');
    expect(deps.runCommand).toHaveBeenNthCalledWith(1, 'skillshare', ['update', '--all'], '/tmp/skillshare');
    expect(deps.runCommand).toHaveBeenNthCalledWith(2, 'skillshare', ['sync', '--all'], '/tmp/skillshare');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Skillshare 有更新',
      level: 'info',
    }));
  });

  test('installs tracked sources from skillshare metadata before updating when tracked repos are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillshare-sync-'));
    const metadataPath = path.join(root, 'skills', '.metadata.json');
    const originalMetadata = JSON.stringify({
      version: 1,
      entries: {
        _trackedOne: { source: 'https://example.com/one.git', tracked: true, branch: 'main' },
        _trackedTwo: { source: 'https://example.com/two.git', tracked: true, branch: 'develop' },
        '_frontend-design-official': { source: 'https://example.com/official.git', tracked: true, branch: 'main' },
        '_skill-creator-official': { source: 'https://example.com/official.git', tracked: true, branch: 'main' },
        local: { source: '/tmp/local', tracked: false },
      },
    }, null, 2);
    await fs.mkdir(path.join(root, 'skills'), { recursive: true });
    await fs.writeFile(metadataPath, originalMetadata);
    const deps = createDeps({
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce(snapshot([['/skills', 'aaa']]))
        .mockResolvedValueOnce(snapshot([['/skills', 'aaa']])),
      runCommand: jest.fn(async (_cmd, args) => {
        if (args[0] === 'install') {
          await fs.writeFile(metadataPath, JSON.stringify({
            version: 1,
            entries: {
              rewrittenBySkillshare: { source: args[1], tracked: true },
            },
          }));
        }
        if (args[0] === 'update') {
          await expect(fs.readFile(metadataPath, 'utf8')).resolves.toBe(originalMetadata);
          await fs.writeFile(metadataPath, JSON.stringify({
            version: 1,
            entries: {
              rewrittenByUpdate: { source: 'https://example.com/update.git', tracked: true },
            },
          }));
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
    });

    const result = await runSkillshareSyncNotify({ skillshareRoot: root }, deps);

    expect(result.status).toBe('unchanged');
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', [
      'install',
      'https://example.com/one.git',
      '--track',
      '--branch',
      'main',
      '--name',
      'trackedOne',
      '--force',
    ], root);
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', [
      'install',
      'https://example.com/two.git',
      '--track',
      '--branch',
      'develop',
      '--name',
      'trackedTwo',
      '--force',
    ], root);
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', ['update', '--all'], root);
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', [
      'install',
      'https://example.com/official.git',
      '--track',
      '--branch',
      'main',
      '--name',
      'frontend-design-official',
      '--force',
    ], root);
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', [
      'install',
      'https://example.com/official.git',
      '--track',
      '--branch',
      'main',
      '--name',
      'skill-creator-official',
      '--force',
    ], root);
    await expect(fs.readFile(metadataPath, 'utf8')).resolves.toBe(originalMetadata);
  });

  test('installs only missing tracked repositories and preserves installed ones', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillshare-sync-'));
    const metadataPath = path.join(root, 'skills', '.metadata.json');
    await fs.mkdir(path.join(root, 'skills', '_installed', '.git'), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify({
      version: 1,
      entries: {
        _installed: { source: 'https://example.com/installed.git', tracked: true, branch: 'main' },
        _missing: { source: 'https://example.com/missing.git', tracked: true, branch: 'main' },
      },
    }, null, 2));
    const deps = createDeps({
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce(snapshot([['/skills/_installed', 'aaa']]))
        .mockResolvedValueOnce(snapshot([['/skills/_installed', 'aaa']])),
    });

    await runSkillshareSyncNotify({ skillshareRoot: root }, deps);

    expect(deps.runCommand).not.toHaveBeenCalledWith(
      'skillshare',
      expect.arrayContaining(['https://example.com/installed.git']),
      root
    );
    expect(deps.runCommand).toHaveBeenCalledWith('skillshare', [
      'install',
      'https://example.com/missing.git',
      '--track',
      '--branch',
      'main',
      '--name',
      'missing',
      '--force',
    ], root);
  });

  test('clears skillshare-managed gitignore entries after commands rewrite them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillshare-sync-'));
    const gitignorePath = path.join(root, 'skills', '.gitignore');
    await fs.mkdir(path.join(root, 'skills', '_repo', '.git'), { recursive: true });
    await fs.writeFile(path.join(root, 'skills', '.metadata.json'), JSON.stringify({
      version: 1,
      entries: {
        _repo: { source: 'https://example.com/repo.git', tracked: true, branch: 'main' },
      },
    }, null, 2));
    await fs.writeFile(gitignorePath, [
      '*',
      '!.gitignore',
      '!.metadata.json',
      '',
      '# BEGIN SKILLSHARE MANAGED - DO NOT EDIT',
      '_repo/',
      '# END SKILLSHARE MANAGED',
      '',
    ].join('\n'));
    const deps = createDeps({
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce(snapshot([['/skills/_repo', 'aaa']]))
        .mockResolvedValueOnce(snapshot([['/skills/_repo', 'bbb']])),
      runCommand: jest.fn(async (_cmd, args) => {
        if (args[0] === 'update' || args[0] === 'sync') {
          await fs.writeFile(gitignorePath, [
            '*',
            '!.gitignore',
            '!.metadata.json',
            '',
            '# BEGIN SKILLSHARE MANAGED - DO NOT EDIT',
            '_repo/',
            '_other/',
            '# END SKILLSHARE MANAGED',
            '',
          ].join('\n'));
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
    });

    await runSkillshareSyncNotify({ skillshareRoot: root }, deps);

    await expect(fs.readFile(gitignorePath, 'utf8')).resolves.toBe([
      '*',
      '!.gitignore',
      '!.metadata.json',
      '',
      '# BEGIN SKILLSHARE MANAGED - DO NOT EDIT',
      '# END SKILLSHARE MANAGED',
      '',
    ].join('\n'));
  });

  test('does not sync or notify when update changes no repo heads', async () => {
    const deps = createDeps({
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce(snapshot([['/skills/a', 'aaa']]))
        .mockResolvedValueOnce(snapshot([['/skills/a', 'aaa']])),
    });

    const result = await runSkillshareSyncNotify({
      skillshareRoot: '/tmp/skillshare',
    }, deps);

    expect(result.status).toBe('unchanged');
    expect(deps.runCommand).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('collectTrackedMetadataRoots returns skillshare source roots with tracked metadata entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillshare-sync-'));
    await fs.mkdir(path.join(root, 'skills'), { recursive: true });
    await fs.mkdir(path.join(root, 'agents'), { recursive: true });
    await fs.writeFile(path.join(root, 'skills', '.metadata.json'), JSON.stringify({
      version: 1,
      entries: {
        tracked: { source: 'https://example.com/skills.git', tracked: true, branch: 'main' },
        local: { source: '/tmp/local', tracked: false },
      },
    }));
    await fs.writeFile(path.join(root, 'agents', '.metadata.json'), JSON.stringify({
      version: 1,
      entries: {
        onlyLocal: { source: '/tmp/agent', tracked: false },
      },
    }));

    await expect(collectTrackedMetadataRoots(root)).resolves.toEqual([path.join(root, 'skills')]);
  });

  test('collectGitSnapshot snapshots tracked skillshare repositories instead of unrelated nested repos', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillshare-sync-'));
    const skillsDir = path.join(root, 'skills');
    const unrelatedDir = path.join(root, 'unrelated');
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(unrelatedDir, { recursive: true });
    await fs.mkdir(path.join(skillsDir, '_tracked'), { recursive: true });
    await fs.writeFile(path.join(skillsDir, '.metadata.json'), JSON.stringify({
      version: 1,
      entries: {
        _tracked: { source: 'https://example.com/skills.git', tracked: true, branch: 'main' },
      },
    }));
    await fs.writeFile(path.join(unrelatedDir, 'README.md'), 'ignore\n');
    await fs.mkdir(path.join(skillsDir, '_tracked', '.git'), { recursive: true });
    await fs.mkdir(path.join(unrelatedDir, '.git'), { recursive: true });
    const command = jest.fn(async (_cmd: string, args: string[], cwd: string) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: `${cwd}-head\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });

    const snapshot = await collectGitSnapshot(root, command);

    expect(Array.from(snapshot.keys())).toEqual([path.join(skillsDir, '_tracked')]);
    expect(snapshot.get(path.join(skillsDir, '_tracked'))).toBe(`${path.join(skillsDir, '_tracked')}-head\n`);
    expect(command).toHaveBeenCalledTimes(2);
  });

  test('sends warn notification when skillshare update fails', async () => {
    const deps = createDeps({
      getSnapshot: jest.fn(async () => snapshot([['/skills/a', 'aaa']])),
      runCommand: jest.fn(async () => ({ code: 1, stdout: '', stderr: 'network failed' })),
    });

    const result = await runSkillshareSyncNotify({
      skillshareRoot: '/tmp/skillshare',
      feishu: { type: 'feishu', app_id: 'cli_test', app_secret: 'secret', receive_id: 'chat' },
    }, deps);

    expect(result.status).toBe('failed');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Skillshare 同步失败',
      level: 'warn',
      content: expect.stringContaining('network failed'),
    }));
  });

  test('reads Feishu channel from YAML config when env points to a config file', () => {
    const readFile = jest.fn(() => [
      'channels:',
      '  - type: feishu',
      '    app_id: cli_from_file',
      '    app_secret: secret_from_file',
      '    receive_id: chat_from_file',
      '    receive_id_type: chat_id',
    ].join('\n'));

    const config = readConfigFromEnv({
      SKILLSHARE_ROOT: '/tmp/skillshare',
      SKILLSHARE_NOTIFY_CONFIG: '/tmp/config.yaml',
    }, '/repo', readFile);

    expect(config.feishu).toEqual(expect.objectContaining({
      app_id: 'cli_from_file',
      app_secret: 'secret_from_file',
      receive_id: 'chat_from_file',
    }));
  });
});
