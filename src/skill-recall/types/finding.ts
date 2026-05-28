// Detector 检出的单条发现 (SPEC §10, append-only 到 findings/<ts>.jsonl)

export type FindingType =
  | "trigger-miss"
  | "false-trigger"
  | "wrong-skill"
  | "red-flag-hit"
  | "user-aborted"
  | "silent-retry"
  | "manual-revert"
  | "step-skip"
  | "implicit-constraint-violation"
  | "llm-inferred-failure"

export type FailureCategory =
  | "tool/not-found" | "tool/permission-denied" | "tool/timeout" | "tool/output-truncated"
  | "agent/loop" | "agent/spin-no-action" | "agent/wrong-tool" | "agent/off-topic"
  | "ctx/compacted" | "ctx/lost-after-compact" | "ctx/cross-session-amnesia"
  | "user/explicit-stop" | "user/silent-retry" | "user/manual-revert"
  | "sys/rate-limit" | "sys/quota"

export interface Finding {
  skill: string
  type: FindingType
  severity: "low" | "medium" | "high"
  session_id: string
  source: string
  event_id?: string
  event_index?: number
  description: string
  user_msg_snippet?: string
  failure_category?: FailureCategory
  confidence: number
  detector: string
  detected_at: string
  suggested_action?: string
}
