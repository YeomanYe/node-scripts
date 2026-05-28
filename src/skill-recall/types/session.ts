// Mirror of agent-sessions-cli JSON output (see SPEC §17 #1 — verified 2026-05-28)
//
// 关键发现: Claude Code 的 skill 调用**不**走结构化 tool_call event,
// 而是在 user 角色的 text 里出现 "Launching skill: <name>" 字符串.
// 所以 skill 识别要 grep text 而非读 tool_name 字段.

export interface SessionListItem {
  id: string
  short_id: string
  source: "claude" | "codex" | "gemini" | "copilot" | "droid" | "opencode" | "openclaw"
  source_display: string
  title: string | null
  file_path: string
  start_time: string | null
  end_time: string | null
  modified_at: string
  model: string | null
  file_size_bytes: number
  event_count: number
  message_count: number
  is_housekeeping: boolean
  cwd: string | null
  repo_name: string | null
  custom_title: string | null
  parent_session_id: string | null
  subagent_type: string | null
}

export interface SessionEvent {
  id: string
  timestamp: string | null
  kind: "user" | "assistant" | "tool_call" | "tool_result" | "error" | "meta"
  role: string | null
  text: string | null
  tool_name: string | null
  tool_input: string | null
  tool_output: string | null
  message_id: string | null
  parent_id: string | null
  is_delta: boolean
}

export interface SessionDetail extends SessionListItem {
  events: SessionEvent[]
}

export interface AgentSessionsCliResponse<T> {
  ok: boolean
  data: T
  error: string | null
  meta?: {
    count?: number
    total?: number
    offset?: number
  }
}

export type SessionListResponse = AgentSessionsCliResponse<{
  sessions: SessionListItem[]
}>

export type SessionShowResponse = AgentSessionsCliResponse<SessionDetail>
