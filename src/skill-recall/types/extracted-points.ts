// SKILL.md 提取后的关注点结构 (SPEC §6)

export interface StaticExtractedPoints {
  trigger_phrases: string[]
  do_not_use_phrases: string[]
  red_flags: string[]
  workflow_steps: string[]
  skill_name: string
  skill_md_path: string
  skill_md_git_hash?: string
  extracted_at: string
}

export interface LlmExtractedPoints {
  implicit_constraints: Array<{
    description: string
    detection_hint: string
  }>
  hidden_anti_patterns: Array<{
    description: string
    detection_hint: string
  }>
  downstream_handoff_required: Array<{
    description: string
    detection_hint: string
  }>
  skill_name: string
  skill_md_git_hash?: string
  extracted_at: string
  llm_model: string
}

export interface ExtractedPoints {
  static: StaticExtractedPoints
  llm?: LlmExtractedPoints
}
