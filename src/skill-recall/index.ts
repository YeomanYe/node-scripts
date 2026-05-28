#!/usr/bin/env node
// skill-recall CLI — agent 日志分析工具 (SPEC §9)
//
// 命令:
//   skill-recall run [--full] [--skill <name>] [--config <path>] [--dry-run]
//   skill-recall extract <skill-name> [--rerun]
//   skill-recall doctor
//
// MVP scope (Phase 1):
// - static extractor + trigger-miss detector
// - LLM extractor / 其他 detector → Phase 2

import { Command } from "commander"
import * as fs from "fs"
import * as path from "path"
import { loadConfig } from "./loader/config-loader"
import { loadSkillMd } from "./loader/skill-md-loader"
import { extractStatic } from "./extractors/static-extractor"
import {
  listSessions,
  showSession,
} from "./source/agent-sessions-cli"
import { ProcessedTracker } from "./cache/processed-tracker"
import { SessionArchiver } from "./storage/session-archiver"
import { detectTriggerMiss } from "./detectors/trigger-miss"
import { FindingsWriter } from "./reports/findings-writer"
import type { StaticExtractedPoints } from "./types/extracted-points"
import type { Finding } from "./types/finding"

const program = new Command()
program
  .name("skill-recall")
  .description("Agent log analysis for skill recall/precision tuning")
  .version("0.1.0")

program
  .command("run")
  .description("Run analysis (incremental by default)")
  .option("--full", "Full rebuild instead of incremental", false)
  .option("--skill <name>", "Only analyze a specific registered skill")
  .option("--config <path>", "Custom config path")
  .option("--dry-run", "Compute but do not write findings", false)
  .option("--limit <n>", "Cap sessions analyzed (debug)", parseIntOpt)
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const cache = new ProcessedTracker(config.incremental.cache_path)
    const archiver = new SessionArchiver(config.storage.base_path, config.storage.enabled)

    // 1. Extract points for each registered skill (static only in Phase 1)
    const targetSkills = config.registered_skills
      .filter((s) => s.enabled)
      .filter((s) => !opts.skill || s.name === opts.skill)
    if (targetSkills.length === 0) {
      console.error("No registered skills (or --skill filter excluded all)")
      process.exit(2)
    }

    console.log(`[skill-recall] extracting points for ${targetSkills.length} skill(s)…`)
    const pointsBySkill: Record<string, StaticExtractedPoints> = {}
    for (const s of targetSkills) {
      try {
        const loaded = loadSkillMd(s.name)
        const points = extractStatic(loaded)
        // 合并 extra_triggers / extra_red_flags(手动补充)
        if (s.extra_triggers) points.trigger_phrases.push(...s.extra_triggers)
        if (s.extra_red_flags) points.red_flags.push(...s.extra_red_flags)
        pointsBySkill[s.name] = points
        cacheExtracted(config.storage.base_path, points)
        console.log(
          `  ${s.name}: ${points.trigger_phrases.length} triggers, ${points.do_not_use_phrases.length} do-not-use, ${points.red_flags.length} red-flags, ${points.workflow_steps.length} steps`
        )
      } catch (e) {
        console.error(`  ${s.name}: extract failed — ${(e as Error).message}`)
      }
    }

    // 2. List sessions (incremental or full)
    const since = opts.full ? undefined : computeSince(cache, config.incremental.fallback_window)
    console.log(`[skill-recall] listing sessions${since ? ` since ${since}` : " (full)"}…`)
    const sessions = listSessions({
      agent: "claude",
      limit: opts.limit ?? 100,
      since,
    })
    console.log(`  found ${sessions.length} session(s)`)

    // 3. For each session: show → archive → detect
    const findings: Finding[] = []
    let processedCount = 0
    let skippedCount = 0

    for (const list of sessions) {
      if (!opts.full && cache.isProcessed(list.id)) {
        skippedCount++
        continue
      }
      try {
        const detail = showSession(list.id, list.source)
        archiver.archive(detail)

        const sessionFindings = detectTriggerMiss(detail, pointsBySkill)
        findings.push(...sessionFindings)

        cache.markProcessed(list.id)
        processedCount++
      } catch (e) {
        console.error(`  session ${list.short_id}: failed — ${(e as Error).message}`)
      }
    }

    console.log(
      `[skill-recall] processed ${processedCount}, skipped ${skippedCount} (already in cache), findings: ${findings.length}`
    )

    // 4. Write findings (unless --dry-run)
    if (!opts.dryRun && findings.length > 0) {
      const writer = new FindingsWriter(config.storage.base_path)
      const result = writer.write(findings)
      console.log(`  findings written: ${result.path}`)
    } else if (opts.dryRun) {
      console.log(`  (dry-run, findings not written)`)
      if (findings.length > 0) {
        console.log("  sample:")
        for (const f of findings.slice(0, 5)) {
          console.log(
            `    [${f.type}] ${f.skill} — ${f.description.slice(0, 80)} (conf ${f.confidence})`
          )
        }
      }
    }

    cache.markRunComplete()
  })

program
  .command("doctor")
  .description("Check setup: config, agent-sessions-cli availability, env vars")
  .action(() => {
    try {
      const config = loadConfig()
      console.log("✓ config loaded")
      console.log(`  registered skills: ${config.registered_skills.map((s) => s.name).join(", ")}`)
      console.log(`  storage base: ${config.storage.base_path} (enabled: ${config.storage.enabled})`)
      console.log(`  cache: ${config.incremental.cache_path}`)
      if (config.llm_fallback.enabled) {
        const keySet = !!process.env[config.llm_fallback.api_key_env]
        console.log(`  llm fallback: ${config.llm_fallback.provider} (key: ${keySet ? "set" : "MISSING"})`)
      } else {
        console.log("  llm fallback: disabled")
      }
      const sessions = listSessions({ agent: "claude", limit: 1 })
      console.log(`✓ agent-sessions-cli reachable (sample session: ${sessions[0]?.short_id ?? "none"})`)
    } catch (e) {
      console.error("✗ doctor failed:", (e as Error).message)
      process.exit(1)
    }
  })

program.parse()

// ─── helpers ────────────────────────────────────────────────────────────────

function parseIntOpt(v: string): number {
  const n = Number.parseInt(v, 10)
  if (Number.isNaN(n)) throw new Error(`invalid number: ${v}`)
  return n
}

function computeSince(cache: ProcessedTracker, fallback: string): string {
  const last = cache.getLastRunAt()
  if (last) return last
  // fallback "7d" / "30d"
  const m = fallback.match(/^(\d+)d$/)
  const days = m ? parseInt(m[1], 10) : 7
  const t = new Date()
  t.setUTCDate(t.getUTCDate() - days)
  return t.toISOString()
}

function cacheExtracted(basePath: string, points: StaticExtractedPoints): void {
  const file = path.join(basePath, "extracted", `${points.skill_name}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ static: points }, null, 2), "utf8")
}
