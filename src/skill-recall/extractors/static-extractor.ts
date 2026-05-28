// 程序化从 SKILL.md 提取 4 维关注点 (SPEC §6.1)
//
// 4 维:
// 1. trigger_phrases   — frontmatter description 里"触发短语:..."/ "Trigger phrases:..."
// 2. do_not_use        — frontmatter "Do NOT use for:..." + body "## When NOT to Use" 段
// 3. red_flags         — body "## Red Flags" / "## Red Flags & Rationalizations" 段 bullets
// 4. workflow_steps    — body "## Required Workflow" 段 "### Step N" 标题

import type { LoadedSkillMd } from "../loader/skill-md-loader"
import type { StaticExtractedPoints } from "../types/extracted-points"

export function extractStatic(loaded: LoadedSkillMd): StaticExtractedPoints {
  const triggers = extractTriggerPhrases(loaded.description)
  const doNotUseFromDesc = extractDoNotUseFromDescription(loaded.description)
  const doNotUseFromBody = extractDoNotUseFromBody(loaded.body)
  const redFlags = extractSectionBullets(loaded.body, [
    "Red Flags — STOP",
    "Red Flags",
    "Red Flags & Rationalizations",
  ])
  const workflowSteps = extractWorkflowSteps(loaded.body)

  return {
    trigger_phrases: dedupe(triggers),
    do_not_use_phrases: dedupe([...doNotUseFromDesc, ...doNotUseFromBody]),
    red_flags: dedupe(redFlags),
    workflow_steps: dedupe(workflowSteps),
    skill_name: loaded.skill_name,
    skill_md_path: loaded.skill_md_path,
    skill_md_git_hash: loaded.git_hash,
    extracted_at: new Date().toISOString(),
  }
}

// ─── 1. 触发短语 ─────────────────────────────────────────────────────────────

function extractTriggerPhrases(description: string): string[] {
  // 找各种 "触发" 段起始, 抓后续 ~500 char 段, 用引号 + 「」 + / + 、 切片
  const phrases: string[] = []
  const markers = [
    /触发短语[包括]*[:：]/g,
    /自动触发关键词[:：]/g,
    /自动激活信号[^:：]*[:：]/g,
    /显式触发[:：]/g,
    /上游触发[:：]/g,
    /Trigger phrases:?/gi,
    /Triggers? phrases?\s*include/gi,
    /Triggers? on phrases? like/gi,
    /Triggered by phrases? like/gi,
    /Triggers? on(?: requests?)?(?: like)?[:：]?/gi,
  ]

  for (const marker of markers) {
    let m: RegExpExecArray | null
    marker.lastIndex = 0
    while ((m = marker.exec(description)) !== null) {
      const window = description.slice(m.index + m[0].length, m.index + m[0].length + 600)
      const stopAt = window.search(/(?:Do NOT use|完整触发清单|优先级[:：]|\n\s*\n)/)
      const slice = stopAt >= 0 ? window.slice(0, stopAt) : window
      // 既抓引号片段, 也抓 / 和 、 分隔的裸短语
      const quoted = extractQuotedFragments(slice)
      const bare = extractBareDelimited(slice)
      phrases.push(...quoted, ...bare)
    }
  }
  return phrases
}

// 抓"短语1 / 短语2 / 短语3" 或"X、Y、Z" 这种裸短语序列
function extractBareDelimited(text: string): string[] {
  const out: string[] = []
  // 按 / 或 、或 , 切, 每段去前后空白, 过滤过长 / 过短
  const parts = text
    .replace(/\n/g, " ")
    .split(/[\/、,，]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 60)
  for (const p of parts) {
    // 跳过明显是英文段(含 of/the/with/for 等 stopwords) — 那是描述不是 trigger
    // 但带中文的或纯短词照收
    if (/^[a-zA-Z]+( [a-zA-Z]+){3,}$/.test(p)) continue
    // 跳过含冒号 / 句号 的(可能跨段抓乱了)
    if (/[:：。.]/.test(p)) continue
    out.push(p)
  }
  return out
}

// 中英双引号 + 「」 都抓
function extractQuotedFragments(text: string): string[] {
  const out: string[] = []
  // "..."  '...'  "..."  «...»  「...」
  const patterns = [
    /"([^"\n]{2,80})"/g,
    /"([^"\n]{2,80})"/g,
    /「([^」\n]{2,80})」/g,
    /'([^'\n]{2,80})'/g,
    /'([^'\n]{2,80})'/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const s = m[1].trim()
      if (s) out.push(s)
    }
  }
  return out
}

// ─── 2. Do NOT use(双源)──────────────────────────────────────────────────

function extractDoNotUseFromDescription(description: string): string[] {
  // "Do NOT use for:..." / "Do NOT use(...): ..."
  const re = /Do NOT use(?:\([^)]+\))?\s*(?:for)?\s*[:：]?\s*([^\n]+(?:\n[^A-Z\n][^\n]*)*)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(description)) !== null) {
    // 整段按 "/" "、" "," 分割
    const seg = m[1].trim()
    const parts = seg.split(/[\/、,，]/).map((p) => p.trim()).filter(Boolean)
    out.push(...parts)
  }
  return out
}

function extractDoNotUseFromBody(body: string): string[] {
  // "## When NOT to Use" 段下的 bullets
  return extractSectionBullets(body, ["When NOT to Use"])
}

// ─── 3. Section bullets(Red Flags 等)─────────────────────────────────────

function extractSectionBullets(body: string, sectionTitles: string[]): string[] {
  for (const title of sectionTitles) {
    const re = new RegExp(`^##+\\s+${escapeRegex(title)}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "m")
    const m = body.match(re)
    if (m) {
      return parseBullets(m[1])
    }
  }
  return []
}

function parseBullets(section: string): string[] {
  // 抓行首 - / * / +  + 一个空格 + 内容
  const lines = section.split("\n")
  const out: string[] = []
  for (const ln of lines) {
    const m = ln.match(/^\s*[-*+]\s+(.+)$/)
    if (m) {
      // 去掉 markdown 加粗 / 内联代码标记, 保留核心句
      const cleaned = m[1].replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim()
      if (cleaned.length > 5) {
        // 取第一句(避免抓上多行说明)
        const firstSentence = cleaned.split(/[—\n]|\s+——\s+/)[0].trim()
        if (firstSentence.length > 5) out.push(firstSentence)
      }
    }
  }
  return out
}

// ─── 4. Workflow steps ──────────────────────────────────────────────────────

function extractWorkflowSteps(body: string): string[] {
  // 抓 "## Required Workflow" / "## Mandatory Workflow" 段下的所有 "### Step N" / "### Stage N"
  const re = /^##+\s+(?:Required Workflow|Mandatory Workflow|Workflow|必要流程)[\s\S]*?(?=^##\s|\Z)/m
  const m = body.match(re)
  if (!m) return []

  const section = m[0]
  const steps: string[] = []
  // ### Step 0 / Step 0.1 / Stage 1 — title
  const stepRe = /^###+\s+(?:Step|Stage|阶段)\s*([0-9]+(?:\.[0-9]+)?)[\s—:：·\-]+(.+)$/gm
  let sm: RegExpExecArray | null
  while ((sm = stepRe.exec(section)) !== null) {
    const num = sm[1]
    const title = sm[2].replace(/[（(].*?[)）]/g, "").trim()
    steps.push(`Step ${num}: ${title}`)
  }
  return steps
}

// ─── helpers ────────────────────────────────────────────────────────────────

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
