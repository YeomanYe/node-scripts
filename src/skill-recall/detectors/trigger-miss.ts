// Detector: trigger-miss (漏召)
//
// 定义: 用户原话命中某 skill 的 trigger phrase, 但该 skill 没启动.
//
// 判定逻辑:
// 1. 遍历每条 user message
// 2. 看 message 是否匹配 registered_skills 里任一 skill 的 trigger phrase
// 3. 看后续 N 个 events 内是否出现 "Launching skill: <matched-skill>"
// 4. 没出现 → finding(trigger-miss)
//
// 现在不区分"用户主动放弃 / agent 没识别", 只看"按描述该启动没启动".

import type { SessionDetail, SessionEvent } from "../types/session"
import type { StaticExtractedPoints } from "../types/extracted-points"
import type { Finding } from "../types/finding"
import { extractSkillCalls, extractUserMessages } from "../source/agent-sessions-cli"

/** 用户消息后多少 events 内必须看到 skill 调用 */
const SKILL_LAUNCH_WINDOW = 10

export function detectTriggerMiss(
  session: SessionDetail,
  pointsBySkill: Record<string, StaticExtractedPoints>
): Finding[] {
  const findings: Finding[] = []
  const skillCalls = extractSkillCalls(session)
  const userMsgs = extractUserMessages(session)

  // 为每个 user msg 找匹配的 skill
  for (const um of userMsgs) {
    const text = um.text.toLowerCase()

    for (const skill of Object.keys(pointsBySkill)) {
      const points = pointsBySkill[skill]
      const matched = matchTriggers(text, points.trigger_phrases)
      if (!matched.length) continue

      // 在 um.index 之后 N 个 events 内, 是否有 "Launching skill: skill"?
      const launched = skillCalls.some(
        (c) =>
          c.skill_name === skill &&
          c.event_index > um.index &&
          c.event_index <= um.index + SKILL_LAUNCH_WINDOW
      )
      if (launched) continue

      findings.push({
        skill,
        type: "trigger-miss",
        severity: "medium",
        session_id: session.id,
        source: session.source,
        event_id: um.event_id,
        event_index: um.index,
        description: `用户原话命中 ${skill} 的 trigger 短语 "${matched[0]}", 但 ${SKILL_LAUNCH_WINDOW} events 内未启动`,
        user_msg_snippet: truncate(um.text, 100),
        confidence: confidenceFromMatchCount(matched.length),
        detector: "trigger-miss",
        detected_at: new Date().toISOString(),
        suggested_action: `检查 ${skill} 的 trigger phrases 是否需要补充关键词 "${matched[0]}", 或调整路由优先级`,
      })
    }
  }

  return findings
}

/** 返回所有命中的 trigger phrases */
function matchTriggers(userText: string, triggers: string[]): string[] {
  const out: string[] = []
  for (const t of triggers) {
    const norm = t.toLowerCase().trim()
    if (!norm || norm.length < 2) continue
    if (userText.includes(norm)) out.push(t)
  }
  return out
}

function confidenceFromMatchCount(n: number): number {
  // 1 个匹配 = 0.6 (有可能误判), 多个 = 0.9
  if (n >= 3) return 0.95
  if (n === 2) return 0.85
  return 0.6
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + "…"
}
