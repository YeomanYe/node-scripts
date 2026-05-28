// Subprocess wrapper for agent-sessions-cli (SPEC §3.5 + §17 #5)
//
// 关键发现(verified 2026-05-28):
// - Claude Code skill 调用是 user 角色文本 "Launching skill: <name>"
// - tool_name 字段全空, 不能用结构化字段识别 skill
//
// CLI 安装在 venv: ~/Documents/projects/agent-sessions-cli/.venv/bin/agent-sessions

import { execSync } from "child_process"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import type {
  SessionListItem,
  SessionDetail,
  SessionListResponse,
  SessionShowResponse,
} from "../types/session"

const AGENT_SESSIONS_VENV_BIN = path.join(
  os.homedir(),
  "Documents/projects/agent-sessions-cli/.venv/bin/agent-sessions"
)

function getCliBin(): string {
  // Prefer venv (确定可用); fallback to PATH 用户已 activate venv 时
  if (fs.existsSync(AGENT_SESSIONS_VENV_BIN)) return AGENT_SESSIONS_VENV_BIN
  return "agent-sessions"
}

export interface ListSessionsOptions {
  agent?: "claude" | "codex" | "gemini" | "copilot" | "droid" | "opencode" | "openclaw" | "all"
  limit?: number
  offset?: number
  /** ISO 8601 timestamp, 只取 modified_at >= 这个时间的 */
  since?: string
}

export function listSessions(opts: ListSessionsOptions = {}): SessionListItem[] {
  const bin = getCliBin()
  const args = ["session", "list", "--json"]
  if (opts.agent) args.push("--agent", opts.agent)
  if (opts.limit) args.push("--limit", String(opts.limit))
  if (opts.offset) args.push("--offset", String(opts.offset))

  const out = run(bin, args)
  const parsed = JSON.parse(out) as SessionListResponse
  if (!parsed.ok) throw new Error(`agent-sessions list failed: ${parsed.error}`)

  let sessions = parsed.data.sessions
  if (opts.since) {
    const sinceMs = Date.parse(opts.since)
    sessions = sessions.filter((s) => Date.parse(s.modified_at) >= sinceMs)
  }
  return sessions
}

export function showSession(id: string, agent: string): SessionDetail {
  const bin = getCliBin()
  const out = run(bin, ["session", "show", id, "--agent", agent, "--json"])
  const parsed = JSON.parse(out) as SessionShowResponse
  if (!parsed.ok) throw new Error(`agent-sessions show failed: ${parsed.error}`)
  return parsed.data
}

export function reindex(agent?: string): void {
  const bin = getCliBin()
  const args = ["index"]
  if (agent) args.push("--agent", agent)
  run(bin, args)
}

function run(bin: string, args: string[]): string {
  try {
    return execSync(`"${bin}" ${args.map((a) => `"${a}"`).join(" ")}`, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,  // 256MB 单 session events 可能很大
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`agent-sessions CLI failed: ${msg}`)
  }
}

// ─── Skill 调用识别 ─────────────────────────────────────────────────────────
//
// Claude Code 在 session 里调用 skill 时, user 角色 text 含:
//   "Launching skill: <skill-name>"
// 或者 "Launching skill: <plugin-prefix>:<skill-name>"

const SKILL_LAUNCH_RE = /Launching skill:\s*(?:[a-zA-Z0-9_-]+:)?([a-zA-Z0-9_-]+)/g

export interface SkillCallSite {
  skill_name: string
  event_index: number
  event_id: string
  timestamp: string | null
}

/** 从 session 里抓所有"Launching skill: X" 记录 */
export function extractSkillCalls(detail: SessionDetail): SkillCallSite[] {
  const out: SkillCallSite[] = []
  for (let i = 0; i < detail.events.length; i++) {
    const e = detail.events[i]
    const text = e.text ?? ""
    SKILL_LAUNCH_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SKILL_LAUNCH_RE.exec(text)) !== null) {
      out.push({
        skill_name: m[1],
        event_index: i,
        event_id: e.id,
        timestamp: e.timestamp,
      })
    }
  }
  return out
}

/** 抓 session 里所有真正的"用户原话"事件(排除 tool result 等系统注入) */
export function extractUserMessages(
  detail: SessionDetail
): Array<{ index: number; event_id: string; text: string; timestamp: string | null }> {
  const out: Array<{ index: number; event_id: string; text: string; timestamp: string | null }> =
    []
  for (let i = 0; i < detail.events.length; i++) {
    const e = detail.events[i]
    if (e.kind !== "user") continue
    const text = e.text ?? ""
    // 过滤掉 tool result / skill launch 等"非真用户文本"
    if (
      text.startsWith("[tool result:") ||
      text.startsWith("Launching skill:") ||
      text.startsWith("Base directory for this skill:")
    )
      continue
    if (!text.trim()) continue
    out.push({ index: i, event_id: e.id, text, timestamp: e.timestamp })
  }
  return out
}
