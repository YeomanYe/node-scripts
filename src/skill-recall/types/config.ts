// skill-recall config schema (see docs/SPEC-skill-recall.md §8 + §11)

export interface SkillRecallConfig {
  storage: {
    enabled: boolean
    base_path: string  // ~ 会被 expand 到 $HOME
  }
  incremental: {
    cache_path: string
    fallback_window: string  // e.g. "7d"
  }
  llm_fallback: {
    enabled: boolean
    provider: "minimax-anthropic" | "claude-subprocess"
    base_url: string
    model: string
    api_key_env: string  // env var name, e.g. "MINIMAX_API_KEY"
    budget_per_run: number
  }
  reporting: {
    weekly_output: string  // template with {week} placeholder
    push_to_im: boolean
  }
  registered_skills: RegisteredSkill[]
}

export interface RegisteredSkill {
  name: string
  enabled: boolean
  extract_from_skill_md: boolean
  use_llm_extraction: boolean
  extra_focus?: string[]  // 额外关注点(纯文本提示, 给 LLM 用)
  extra_triggers?: string[]  // 手动补充的 trigger 短语
  extra_red_flags?: string[]  // 手动补充的 red flag
}
