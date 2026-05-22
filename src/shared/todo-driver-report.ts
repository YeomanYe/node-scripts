import { TaskResult } from '../codex-task-runner/types';

const MAX_SUMMARY_CHARS = 900;
const MAX_ERROR_TAIL_CHARS = 600;
const MAX_CARD_CHARS = 4000;
const MAX_ATTACHMENT_LIST_CHARS = 1800;

type TodoVerdict = 'success' | 'failure' | 'skipped' | 'idle';

interface TodoAttachment {
  type?: unknown;
  path?: unknown;
  caption?: unknown;
}

interface TodoError {
  step?: unknown;
  exit?: unknown;
  tail?: unknown;
}

export interface TodoDriverReport {
  stage: number;
  verdict: TodoVerdict;
  slug: string | null;
  summary: string;
  im_attach?: TodoAttachment[];
  errors?: TodoError[];
}

export interface TodoDriverImage {
  type: 'image';
  path: string;
  caption?: string;
}

export interface TodoDriverFile {
  type: 'file';
  path: string;
  caption?: string;
}

export type TodoDriverAttachmentToSend = TodoDriverImage | TodoDriverFile;

export interface TodoDriverNotification {
  title: string;
  content: string;
  level: 'info' | 'warn';
  stage: number | null;
  slug: string | null;
  attachments: TodoDriverAttachmentToSend[];
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractJsonCandidate(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1).trim();
}

function parseVerdict(value: unknown): TodoVerdict | null {
  if (value === 'success' || value === 'failure' || value === 'skipped' || value === 'idle') {
    return value;
  }
  return null;
}

export function parseTodoDriverReport(text: string): TodoDriverReport | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const stage = typeof obj.stage === 'number' && Number.isFinite(obj.stage) ? obj.stage : null;
  const verdict = parseVerdict(obj.verdict);
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const slug = typeof obj.slug === 'string' ? obj.slug : obj.slug === null ? null : null;

  if (stage === null || !verdict || !summary) return null;

  return {
    stage,
    verdict,
    slug,
    summary,
    im_attach: Array.isArray(obj.im_attach) ? (obj.im_attach as TodoAttachment[]) : [],
    errors: Array.isArray(obj.errors) ? (obj.errors as TodoError[]) : [],
  };
}

function imAttachments(report: TodoDriverReport): TodoDriverAttachmentToSend[] {
  const attachments: TodoDriverAttachmentToSend[] = [];
  for (const item of report.im_attach ?? []) {
    if ((item.type !== 'image' && item.type !== 'file') || typeof item.path !== 'string' || item.path.trim() === '') {
      continue;
    }
    attachments.push({
      type: item.type,
      path: item.path,
      caption: typeof item.caption === 'string' ? item.caption : undefined,
    });
  }
  return attachments;
}

function formatErrors(errors: TodoError[] | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  const lines = ['errors:'];
  for (const err of errors.slice(0, 3)) {
    const step = typeof err.step === 'string' ? err.step : 'unknown';
    const exit = typeof err.exit === 'number' || typeof err.exit === 'string' ? String(err.exit) : '-';
    const tail = typeof err.tail === 'string' ? truncate(err.tail, MAX_ERROR_TAIL_CHARS) : '';
    lines.push(`- ${step} exit=${exit}${tail ? `: ${tail}` : ''}`);
  }
  if (errors.length > 3) lines.push(`- omitted ${errors.length - 3} more error(s)`);
  return lines;
}

function formatTodoReport(report: TodoDriverReport): TodoDriverNotification {
  const failed = report.verdict === 'failure';
  const slug = report.slug ?? '-';
  const attachments = imAttachments(report);
  const lines = [
    `stage: ${report.stage}`,
    `slug: ${slug}`,
    `summary: ${truncate(report.summary, MAX_SUMMARY_CHARS)}`,
  ];

  if (failed) {
    lines.push(...formatErrors(report.errors));
  }
  if (attachments.length > 0) {
    const attachmentLines = attachments.map((item, index) => {
      const label = item.caption?.trim() || item.path;
      return `${index + 1}. ${item.type}: ${truncate(label, 120)}`;
    });
    lines.push('im_attach:');
    lines.push(...truncate(attachmentLines.join('\n'), MAX_ATTACHMENT_LIST_CHARS).split('\n'));
  }

  return {
    title: `${failed ? 'TODO 失败' : 'TODO 更新'}: stage${report.stage} ${slug}`,
    content: truncate(lines.join('\n'), MAX_CARD_CHARS),
    level: failed ? 'warn' : 'info',
    stage: report.stage,
    slug: report.slug,
    attachments,
  };
}

function fallbackNotification(
  taskName: string,
  result: TaskResult,
  iter: number,
  totalCount: number
): TodoDriverNotification {
  const succeeded = result.status === 'success';
  const total = totalCount > 0 ? `/${totalCount}` : '';
  return {
    title: `${succeeded ? '任务完成' : '任务失败'}: ${taskName}`,
    content: truncate(
      [
        `stage: -`,
        `slug: -`,
        `summary: ${truncate(result.summary, MAX_SUMMARY_CHARS)}`,
        `- 迭代: ${iter}${total}`,
        `- 状态: ${result.status}`,
        `- 耗时: ${result.durationSec}s`,
        `- 费用: $${result.costUsd.toFixed(4)}`,
      ].join('\n'),
      MAX_CARD_CHARS
    ),
    level: succeeded ? 'info' : 'warn',
    stage: null,
    slug: null,
    attachments: [],
  };
}

export function buildTodoDriverNotification(
  taskName: string,
  result: TaskResult,
  iter: number,
  totalCount: number
): TodoDriverNotification {
  const report = parseTodoDriverReport(result.output ?? result.summary);
  if (!report) return fallbackNotification(taskName, result, iter, totalCount);
  return formatTodoReport(report);
}
