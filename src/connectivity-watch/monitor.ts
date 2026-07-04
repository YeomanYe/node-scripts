import { performance } from 'perf_hooks';
import type { WatchTarget } from './config';
import type { NotifierMessage } from '../shared/notifiers/types';
import { parseStatusSpec } from '../zai-watch/check';

export interface ProbeResult {
  key: string;
  label: string;
  url: string;
  ok: boolean;
  status: number | null;
  timeMs: number;
  error?: string;
}

export type WatchStatus = 'up' | 'down';

export interface WatchState {
  status: WatchStatus;
  lastChangedAt: string;
}

export interface TransitionNotification {
  kind: WatchStatus;
  results: ProbeResult[];
  changedAt: string;
}

export interface TransitionResult {
  nextState: WatchState;
  notification: TransitionNotification | null;
}

export interface ProbeOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function probeTarget(target: WatchTarget, options: ProbeOptions): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const started = performance.now();

  try {
    const response = await fetchImpl(target.url, {
      method: target.method,
      redirect: 'follow',
      signal: controller.signal,
    });
    const timeMs = Math.round(performance.now() - started);
    const ok = parseStatusSpec(target.successStatus)(response.status);
    return {
      key: target.key,
      label: target.label,
      url: target.url,
      ok,
      status: response.status,
      timeMs,
      ...(ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error: unknown) {
    const timeMs = Math.round(performance.now() - started);
    const isAbort = error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
    return {
      key: target.key,
      label: target.label,
      url: target.url,
      ok: false,
      status: null,
      timeMs,
      error: isAbort ? `timeout after ${options.timeoutMs}ms` : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeTargets(targets: WatchTarget[], options: ProbeOptions): Promise<ProbeResult[]> {
  return Promise.all(targets.map((target) => probeTarget(target, options)));
}

export function evaluateTransition(
  previous: WatchState | null,
  results: ProbeResult[],
  changedAt = nowIso(),
): TransitionResult {
  const currentStatus: WatchStatus = results.every((result) => result.ok) ? 'up' : 'down';
  const statusChanged = previous?.status !== currentStatus;
  const shouldNotify = statusChanged && (currentStatus === 'down' || previous !== null);
  const lastChangedAt = statusChanged ? changedAt : previous?.lastChangedAt ?? changedAt;

  return {
    nextState: {
      status: currentStatus,
      lastChangedAt,
    },
    notification: shouldNotify
      ? {
          kind: currentStatus,
          results,
          changedAt,
        }
      : null,
  };
}

function formatResult(result: ProbeResult): string {
  const status = result.status === null ? 'no status' : `HTTP ${result.status}`;
  const suffix = result.ok ? 'OK' : `FAILED: ${result.error ?? status}`;
  return `- ${result.label} (${result.key}): ${suffix} · ${status} · ${result.timeMs}ms`;
}

export function buildNotification(notification: TransitionNotification): NotifierMessage {
  const failed = notification.results.filter((result) => !result.ok);
  if (notification.kind === 'down') {
    return {
      title: '外网访问异常',
      level: 'warn',
      content: [
        `检测到 ${failed.length}/${notification.results.length} 个目标不可访问。`,
        `时间: ${notification.changedAt}`,
        '',
        ...notification.results.map(formatResult),
      ].join('\n'),
    };
  }

  return {
    title: '外网访问已恢复',
    level: 'info',
    content: [
      `所有 ${notification.results.length} 个目标已恢复访问。`,
      `时间: ${notification.changedAt}`,
      '',
      ...notification.results.map(formatResult),
    ].join('\n'),
  };
}
