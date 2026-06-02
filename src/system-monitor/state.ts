import { BreachInfo, MetricKey } from './types';

interface MetricState {
  /** 连续越限次数（仅当达到阈值前持续累计） */
  consecutiveBreaches: number;
  /** 是否处于已告警状态（达到 consecutive_breaches 后置 true） */
  alerted: boolean;
  /** 上一次发送告警的时间 ms */
  lastAlertMs: number;
  /** 上一次记录的越限快照（用于 recovery 消息中描述峰值） */
  lastBreach: BreachInfo | null;
}

export interface DecisionInput {
  key: MetricKey;
  /** 当前是否越限 */
  breached: boolean;
  /** 当前快照（无论是否越限），用于 recovery 消息引用 */
  snapshot: BreachInfo;
  policy: {
    consecutive_breaches: number;
    cooldown_minutes: number;
    send_recovery: boolean;
  };
  nowMs: number;
}

export type Decision =
  | { type: 'none' }
  | { type: 'alert'; reason: 'new' | 'cooldown_passed' }
  | { type: 'recovery' };

/**
 * 简单的指标状态机：
 * - 没越限时清零 consecutiveBreaches；如果之前是 alerted，触发 recovery
 * - 越限累计；达到 consecutive_breaches 阈值时发首次告警；后续根据 cooldown 节流
 */
export class MetricStateMachine {
  private readonly map = new Map<MetricKey, MetricState>();

  decide(input: DecisionInput): Decision {
    const prev = this.map.get(input.key) ?? this.fresh();

    if (!input.breached) {
      // 恢复路径
      if (prev.alerted) {
        const next: MetricState = {
          consecutiveBreaches: 0,
          alerted: false,
          lastAlertMs: prev.lastAlertMs,
          lastBreach: prev.lastBreach,
        };
        this.map.set(input.key, next);
        return input.policy.send_recovery ? { type: 'recovery' } : { type: 'none' };
      }
      this.map.set(input.key, { ...prev, consecutiveBreaches: 0 });
      return { type: 'none' };
    }

    // 越限路径
    const consecutive = prev.consecutiveBreaches + 1;

    if (!prev.alerted) {
      if (consecutive >= input.policy.consecutive_breaches) {
        this.map.set(input.key, {
          consecutiveBreaches: consecutive,
          alerted: true,
          lastAlertMs: input.nowMs,
          lastBreach: input.snapshot,
        });
        return { type: 'alert', reason: 'new' };
      }
      this.map.set(input.key, {
        consecutiveBreaches: consecutive,
        alerted: false,
        lastAlertMs: prev.lastAlertMs,
        lastBreach: input.snapshot,
      });
      return { type: 'none' };
    }

    // 已告警状态，看 cooldown
    const cooldownMs = input.policy.cooldown_minutes * 60_000;
    if (input.nowMs - prev.lastAlertMs >= cooldownMs) {
      this.map.set(input.key, {
        consecutiveBreaches: consecutive,
        alerted: true,
        lastAlertMs: input.nowMs,
        lastBreach: input.snapshot,
      });
      return { type: 'alert', reason: 'cooldown_passed' };
    }

    this.map.set(input.key, {
      ...prev,
      consecutiveBreaches: consecutive,
      lastBreach: input.snapshot,
    });
    return { type: 'none' };
  }

  private fresh(): MetricState {
    return { consecutiveBreaches: 0, alerted: false, lastAlertMs: 0, lastBreach: null };
  }
}
