import {
  buildTodoDriverNotification,
  parseTodoDriverReport,
} from '../../src/shared/todo-driver-report';
import type { TaskResult } from '../../src/codex-task-runner/types';

function taskResult(output: string, status: TaskResult['status'] = 'success'): TaskResult {
  return {
    index: 1,
    name: 'todo-stage2',
    status,
    emoji: status === 'success' ? '✅' : '❌',
    durationSec: 12,
    costUsd: 0.01,
    exitCode: status === 'success' ? 0 : 1,
    summary: output.slice(0, 200),
    output,
  };
}

describe('todo driver report formatter', () => {
  it('parses fenced JSON reports', () => {
    const report = parseTodoDriverReport(`done\n\`\`\`json
{
  "stage": 2,
  "verdict": "success",
  "slug": "feature-x",
  "summary": "实现完成",
  "im_attach": []
}
\`\`\``);

    expect(report).toMatchObject({
      stage: 2,
      verdict: 'success',
      slug: 'feature-x',
      summary: '实现完成',
    });
  });

  it('formats stage slug summary and all IM attachments in order', () => {
    const message = buildTodoDriverNotification(
      'todo-stage2',
      taskResult(JSON.stringify({
        stage: 2,
        verdict: 'success',
        slug: 'feature-x',
        summary: '实现完成',
        im_attach: [
          { type: 'image', path: '/tmp/a.png', caption: '主页面截图' },
          { type: 'file', path: '/tmp/error.txt', caption: '错误日志' },
        ],
      })),
      1,
      0
    );

    expect(message.level).toBe('info');
    expect(message.stage).toBe(2);
    expect(message.slug).toBe('feature-x');
    expect(message.content).toContain('stage: 2');
    expect(message.content).toContain('slug: feature-x');
    expect(message.content).toContain('summary: 实现完成');
    expect(message.content).toContain('1. image: 主页面截图');
    expect(message.content).toContain('2. file: 错误日志');
    expect(message.attachments).toEqual([
      { type: 'image', path: '/tmp/a.png', caption: '主页面截图' },
      { type: 'file', path: '/tmp/error.txt', caption: '错误日志' },
    ]);
  });

  it('uses error details for failure reports', () => {
    const message = buildTodoDriverNotification(
      'todo-stage2',
      taskResult(JSON.stringify({
        stage: 2,
        verdict: 'failure',
        slug: 'feature-x',
        summary: '测试失败',
        errors: [{ step: 'test', exit: 1, tail: 'FAIL src/app.test.ts' }],
        im_attach: [{ type: 'file', path: '/tmp/error.txt', caption: 'error tail' }],
      })),
      1,
      0
    );

    expect(message.level).toBe('warn');
    expect(message.content).toContain('summary: 测试失败');
    expect(message.content).toContain('errors:');
    expect(message.content).toContain('test exit=1: FAIL src/app.test.ts');
    expect(message.attachments).toEqual([
      { type: 'file', path: '/tmp/error.txt', caption: 'error tail' },
    ]);
  });

  it('falls back to task status when output is not a JSON report', () => {
    const message = buildTodoDriverNotification(
      'todo-stage2',
      taskResult('plain error', 'failed'),
      3,
      5
    );

    expect(message.level).toBe('warn');
    expect(message.content).toContain('stage: -');
    expect(message.content).toContain('slug: -');
    expect(message.content).toContain('summary: plain error');
  });
});
