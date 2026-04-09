import { TaskFile, RunnerConfig, TaskConfig, TaskResult } from './types';
import { getParallelism } from './usage';
import { executeTask } from './executor';
import { sendFeishuCard } from './feishu';
import { log, logError } from './log';

/**
 * 格式化持续时间为可读字符串
 * @param seconds - 秒数
 * @returns 格式化后的时间字符串
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

/**
 * 构建单个任务结果的通知内容
 * @param result - 任务结果
 * @returns Markdown 格式的通知内容
 */
function buildTaskResultContent(result: TaskResult): string {
  const lines: string[] = [
    `${result.emoji} **${result.name}**`,
    `**状态**: ${result.status}`,
    `**耗时**: ${formatDuration(result.durationSec)}`,
    `**费用**: $${result.costUsd.toFixed(4)}`,
    `**摘要**: ${result.summary}`,
  ];
  return lines.join('\n');
}

/**
 * 构建批次摘要通知内容
 * @param batchIndex - 批次索引
 * @param results - 该批次的任务结果
 * @param currentUsage - 当前 API 用量百分比
 * @param currentParallelism - 当前并发度
 * @returns Markdown 格式的通知内容
 */
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

  const lines: string[] = [
    `**批次 #${batchIndex + 1} 完成**`,
    `\u2705 成功: ${successCount} | \u274C 失败: ${failedCount} | \u23F0 超时: ${timeoutCount}`,
    `**本批费用**: $${totalCost.toFixed(4)}`,
    `**API 用量**: ${currentUsage >= 0 ? currentUsage.toFixed(1) + '%' : '未知'}`,
    `**下批并发度**: ${currentParallelism}`,
  ];
  return lines.join('\n');
}

/**
 * 构建最终报告通知内容
 * @param allResults - 全部任务结果
 * @param totalDurationSec - 总耗时（秒）
 * @param stopped - 是否因用量过高而停止
 * @returns Markdown 格式的通知内容
 */
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
    lines.push('');
    lines.push('\u26A0\uFE0F **因 API 用量超过 80% 已停止执行剩余任务**');
  }

  // 列出失败的任务
  const failedTasks = allResults.filter(r => r.status !== 'success');
  if (failedTasks.length > 0) {
    lines.push('');
    lines.push('**异常任务:**');
    for (const task of failedTasks) {
      lines.push(`- ${task.emoji} ${task.name}: ${task.summary}`);
    }
  }

  return lines.join('\n');
}

/**
 * 按优先级排序任务列表
 * @param tasks - 任务配置列表
 * @returns 排序后的任务列表（带原始索引）
 */
function sortByPriority(tasks: TaskConfig[]): Array<{ task: TaskConfig; originalIndex: number }> {
  return tasks
    .map((task, index) => ({ task, originalIndex: index }))
    .sort((a, b) => (a.task.priority ?? 100) - (b.task.priority ?? 100));
}

/**
 * 并行执行一批任务
 * @param batch - 任务批次
 * @param defaults - 默认配置
 * @returns 批次中所有任务的执行结果
 */
async function executeBatch(
  batch: Array<{ task: TaskConfig; originalIndex: number }>,
  defaults: RunnerConfig['defaults']
): Promise<TaskResult[]> {
  const promises = batch.map(({ task, originalIndex }) =>
    executeTask(task, originalIndex, defaults)
  );
  return Promise.all(promises);
}

/**
 * 执行全部任务
 * @param taskFile - 任务文件
 * @param config - 运行器配置
 */
export async function runTasks(taskFile: TaskFile, config: RunnerConfig): Promise<void> {
  const startTime = Date.now();
  const allResults: TaskResult[] = [];
  let stopped = false;

  // 按优先级排序
  const sortedTasks = sortByPriority(taskFile.tasks);
  const totalCount = sortedTasks.length;

  log(`共 ${totalCount} 个任务待执行`);

  // 获取初始并发度
  const initial = await getParallelism(config);

  if (initial.usage >= 80) {
    logError('API 用量已超过 80%，停止执行');
    await sendFeishuCard(
      config.feishu,
      '\u26A0\uFE0F 任务执行中止',
      `API 用量已达 ${initial.usage.toFixed(1)}%，超过 80% 阈值，全部任务已跳过。`
    );
    return;
  }

  // 发送开始通知
  const taskNames = sortedTasks.map(({ task }, i) => `${i + 1}. ${task.name}`).join('\n');
  await sendFeishuCard(
    config.feishu,
    '\u{1F680} 任务开始执行',
    [
      `**任务数**: ${totalCount}`,
      `**初始并发度**: ${initial.parallelism}`,
      `**API 用量**: ${initial.usage >= 0 ? initial.usage.toFixed(1) + '%' : '未知'}`,
      '',
      '**任务列表:**',
      taskNames,
    ].join('\n')
  );

  let currentParallelism = initial.parallelism;
  let pointer = 0;
  let batchIndex = 0;

  while (pointer < totalCount) {
    // 如果并发度为 0，说明用量过高
    if (currentParallelism <= 0) {
      stopped = true;
      logError('并发度为 0，API 用量过高，停止执行');
      await sendFeishuCard(
        config.feishu,
        '\u26A0\uFE0F 任务执行暂停',
        `API 用量过高，已完成 ${allResults.length}/${totalCount} 个任务，剩余任务暂停。`
      );
      break;
    }

    // 取出当前批次
    const batchEnd = Math.min(pointer + currentParallelism, totalCount);
    const batch = sortedTasks.slice(pointer, batchEnd);

    log(`--- 批次 #${batchIndex + 1}: 执行 ${batch.length} 个任务 (并发度: ${currentParallelism}) ---`);

    // 执行当前批次
    const batchResults = await executeBatch(batch, config.defaults);
    allResults.push(...batchResults);

    // 发送每个任务的结果通知
    for (const result of batchResults) {
      await sendFeishuCard(
        config.feishu,
        `${result.emoji} 任务完成: ${result.name}`,
        buildTaskResultContent(result)
      );
    }

    // 检查是否有任务失败且需要停止
    const failedResults = batchResults.filter(r => r.status !== 'success');
    const shouldStop = failedResults.some(r => {
      const taskEntry = sortedTasks.find(t => t.originalIndex === r.index);
      const onFailure = taskEntry?.task.on_failure ?? config.defaults.on_failure;
      return onFailure === 'stop';
    });

    if (shouldStop) {
      stopped = true;
      logError('任务失败且配置为 stop，停止执行');
      break;
    }

    pointer = batchEnd;

    // 如果还有剩余任务，重新检查用量并调整并发度
    if (pointer < totalCount) {
      const updated = await getParallelism(config);

      // 发送批次摘要
      await sendFeishuCard(
        config.feishu,
        `\u{1F4CA} 批次 #${batchIndex + 1} 摘要`,
        buildBatchSummaryContent(batchIndex, batchResults, updated.usage, updated.parallelism)
      );

      if (updated.usage >= 80) {
        stopped = true;
        logError(`API 用量已达 ${updated.usage.toFixed(1)}%，停止执行`);
        await sendFeishuCard(
          config.feishu,
          '\u26A0\uFE0F API 用量超限',
          `API 用量已达 ${updated.usage.toFixed(1)}%，已完成 ${allResults.length}/${totalCount} 个任务，剩余任务停止。`
        );
        break;
      }

      currentParallelism = updated.parallelism;
    }

    batchIndex++;
  }

  // 发送最终报告
  const totalDurationSec = Math.round((Date.now() - startTime) / 1000);
  const reportTitle = stopped ? '\u{1F4CB} 任务执行报告（未完成）' : '\u{1F4CB} 任务执行报告';

  log(`=== 执行完毕: ${allResults.length}/${totalCount} 个任务，耗时 ${formatDuration(totalDurationSec)} ===`);

  await sendFeishuCard(
    config.feishu,
    reportTitle,
    buildFinalReportContent(allResults, totalDurationSec, stopped)
  );
}
