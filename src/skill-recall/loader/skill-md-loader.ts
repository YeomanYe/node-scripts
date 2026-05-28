// 读 ~/Documents/projects/skills/<skill>/SKILL.md
//
// 输出:
// - 原始 markdown 全文
// - frontmatter 解析出的 description
// - 文件的 git hash(用于缓存失效判定)

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { execSync } from "child_process"
import { parse as parseYaml } from "yaml"

const SKILLS_BASE = path.join(os.homedir(), "Documents/projects/skills")

export interface LoadedSkillMd {
  skill_name: string
  skill_md_path: string
  description: string
  body: string  // SKILL.md 主体(去掉 frontmatter)
  full_text: string  // 完整原文(含 frontmatter)
  git_hash?: string  // skills repo 里这个文件的最新 git blob hash
}

export function loadSkillMd(skillName: string): LoadedSkillMd {
  const dir = path.join(SKILLS_BASE, skillName)
  const file = path.join(dir, "SKILL.md")

  if (!fs.existsSync(file)) {
    throw new Error(`SKILL.md not found: ${file}`)
  }

  const full = fs.readFileSync(file, "utf8")
  const { description, body } = parseFrontmatter(full)
  const gitHash = tryGitHash(file)

  return {
    skill_name: skillName,
    skill_md_path: file,
    description,
    body,
    full_text: full,
    git_hash: gitHash,
  }
}

interface ParsedFrontmatter {
  description: string
  body: string
}

function parseFrontmatter(src: string): ParsedFrontmatter {
  // 抓首部 --- ... --- 块
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) {
    return { description: "", body: src }
  }
  const yamlBlock = m[1]
  const body = m[2]
  try {
    const data = parseYaml(yamlBlock) as Record<string, unknown>
    const desc = typeof data.description === "string" ? data.description : ""
    return { description: desc, body }
  } catch {
    return { description: "", body }
  }
}

function tryGitHash(file: string): string | undefined {
  try {
    // git hash-object 出文件 blob hash; 比 commit hash 稳定(改了立刻变)
    const hash = execSync(`git hash-object "${file}"`, {
      encoding: "utf8",
      cwd: path.dirname(file),
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return hash
  } catch {
    return undefined
  }
}
