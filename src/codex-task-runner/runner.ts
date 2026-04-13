import { TaskFile, RunnerConfig, TaskConfig, TaskResult } from './types';
import { getParallelism } from './usage';
import { executeTask } from './executor';
import { sendFeishuCard } from '../claude-task-runner/feishu';
import { log, logError } from './log';
import { loadState, saveTaskSuccess, isTaskCompleted } from './state';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

function buildTaskResultContent(result: TaskResult): string {
  return [
    `${result.emoji} **${result.name}**`,
    `**状态**: ${result.status}`,
    `**耗时**: ${formatDuration(result.durationSec)}`,
    `**费用**: $${result.costUsd.toFixed(4)}`,
    `**摘要**: ${result.summary}`,
  ].join('\n');
}

function buildBatchSummaryContent(
  batchIndex: number,
  results: TaskResult[],
  currentUsage: number,
  currentParallelism: number
): string {
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const timeoutCount = results.filter(r => r.status === 'timeout').length;
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);

  return [
    `**批次 #${batchIndex + 1} 完成**`,
    `\u2705 成功: ${successCount} | \u274C 失败: ${failedCount} | \u23F0 超时: ${timeoutCount}`,
    `**本批费用**: $${totalCost.toFixed(4)}`,
    `**Codex 用量**: ${currentUsage >= 0 ? currentUsage.toFixed(1) + '%' : '未知'}`,
    `**下批并发度**: ${currentParallelism}`,
  ].join('\n');
}

function buildFinalReportContent(
  allResults: TaskResult[],
  totalDurationSec: number,
  stopped: boolean
): string {
  const successCount = allResults.filter(r => r.status === 'success').length;
  const failedCount = allResults.filter(r => r.status === 'failed').length;
  const timeoutCount = allResults.filter(r => r.status === 'timeout').length;
  const totalCost = allResults.reduce((sum, r) => sum + r.costUsd, 0);

  const lines: string[] = [
    `**任务总数**: ${allResults.length}`,
    `\u2705 成功: ${successCount} | \u274C 失败: ${failedCount} | \u23F0 超时: ${timeoutCount}`,
    `**总费用**: $${totalCost.toFixed(4)}`,
    `**总耗时**: ${formatDuration(totalDurationSec)}`,
  ];

  if (stopped) {
    lines.push('', '\u26A0\uFE0F **因 Codex 用量超过 80% 已停止执行剩余任务**');
  }

  const failedTasks = allResults.filter(r => r.status !== 'success');
  if (failedTasks.length > 0) {
    lines.push('', '**异常任务:**');
    for (const task of failedTasks) {
      lines.push(`- ${task.emoji} ${task.name}: ${task.summary}`);
    }
  }

  return lines.join('\n');
}

function sortByPriority(tasks: TaskConfig[]): Array<{ task: TaskConfig; originalIndex: number }> {
  return tasks
    .map((task, index) => ({ task, originalIndex: index }))
    .sort((a, b) => (a.task.priority ?? 100) - (b.task.priority ?? 100));
}

async function executeBatch(
  batch: Array<{ task: TaskConfig; originalIndex: number }>,
  defaults: RunnerConfig['defaults']
): Promise<TaskResult[]> {
  const promises = batch.map(({ task, originalIndex }) =>
    executeTask(task, originalIndex, defaults)
  );
  return Promise.all(promises);
}

export async function runTasks(taskFile: TaskFile, config: RunnerConfig, taskFilePath: string): Promise<void> {
  const startTime = Date.now();
  const allResults: TaskResult[] = [];
  let stopped = false;

  const state = loadState(taskFilePath);
  const sortedTasks = sortByPriority(taskFile.tasks);
  const skippedTasks = sortedTasks.filter(({ task }) => isTaskCompleted(state, task.name));
  const pendingTasks = sortedTasks.filter(({ task }) => !isTaskCompleted(state, task.name));

  if (skippedTasks.length > 0) {
    log(`跳过 ${skippedTasks.length} 个已完成任务: ${skippedTasks.map(({ task }) => task.name).join(', ')}`);
  }

  const totalCount = pendingTasks.length;
  if (totalCount === 0) {
    log('全部任务均已完成，无需执行');
    return;
  }

  log(`共 ${totalCount} 个任务待执行`);

  const initial = await getParallelism(config);
  if (initial.usage >= 80) {
    logError('Codex 用量已超过 80%，停止执行');
    await sendFeishuCard(
      config.feishu,
      '\u26A0\uFE0F 任务执行中止',
      `Codex 用量已达 ${initial.usage.toFixed(1)}%，超过 80% 阈值，全部任务已跳过。`
    );
    return;
  }

  const taskNames = pendingTasks.map(({ task }, i) => `${i + 1}. ${task.name}`).join('\n');
  await sendFeishuCard(
    config.feishu,
    '\u{1F680} Codex 任务开始执行',
    [
      `**任务数**: ${totalCount}`,
      `**初始并发度**: ${initial.parallelism}`,
      `**Codex 用量**: ${initial.usage >= 0 ? initial.usage.toFixed(1) + '%' : '未知'}`,
      '',
      '**任务列表:**',
      taskNames,
    ].join('\n')
  );

  let currentParallelism = initial.parallelism;
  let pointer = 0;
  let batchIndex = 0;

  while (pointer < totalCount) {
    if (currentParallelism <= 0) {
      stopped = true;
      logError('并发度为 0，Codex 用量过高，停止执行');
      await sendFeishuCard(
        config.feishu,
        '\u26A0\uFE0F 任务执行暂停',
        `Codex 用量过高，已完成 ${allResults.length}/${totalCount} 个任务，剩余任务暂停。`
      );
      break;
    }

    const batchEnd = Math.min(pointer + currentParallelism, totalCount);
    const batch = pendingTasks.slice(pointer, batchEnd);

    log(`--- 批次 #${batchIndex + 1}: 执行 ${batch.length} 个任务 (并发度: ${currentParallelism}) ---`);

    const batchResults = await executeBatch(batch, config.defaults);
    allResults.push(...batchResults);

    for (const result of batchResults) {
      if (result.status === 'success') {
        saveTaskSuccess(taskFilePath, result.name);
      }
      await sendFeishuCard(
        config.feishu,
        `${result.emoji} 任务完成: ${result.name}`,
        buildTaskResultContent(result)
      );
    }

    const failedResults = batchResults.filter(r => r.status !== 'success');
    const shouldStop = failedResults.some(r => {
      const taskEntry = pendingTasks.find(t => t.originalIndex === r.index);
      const onFailure = taskEntry?.task.on_failure ?? config.defaults.on_failure;
      return onFailure === 'stop';
    });

    if (shouldStop) {
      stopped = true;
      logError('任务失败且配置为 stop，停止执行');
      break;
    }

    pointer = batchEnd;

    if (pointer < totalCount) {
      const updated = await getParallelism(config);
      await sendFeishuCard(
        config.feishu,
        `\u{1F4CA} 批次 #${batchIndex + 1} 摘要`,
        buildBatchSummaryContent(batchIndex, batchResults, updated.usage, updated.parallelism)
      );

      if (updated.usage >= 80) {
        stopped = true;
        logError(`Codex 用量已达 ${updated.usage.toFixed(1)}%，停止执行`);
        await sendFeishuCard(
          config.feishu,
          '\u26A0\uFE0F 任务执行中止',
          `Codex 用量已达 ${updated.usage.toFixed(1)}%，已完成 ${allResults.length}/${totalCount} 个任务，剩余任务停止。`
        );
        break;
      }

      currentParallelism = updated.parallelism;
      batchIndex += 1;
    }
  }

  const totalDurationSec = Math.round((Date.now() - startTime) / 1000);

  await sendFeishuCard(
    config.feishu,
    stopped ? '\u26A0\uFE0F Codex 任务执行结束（未完成）' : '\u2705 Codex 任务执行完成',
    buildFinalReportContent(allResults, totalDurationSec, stopped)
  );
}
