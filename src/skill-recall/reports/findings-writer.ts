// Append-only 写 findings 到 findings/<timestamp>.jsonl (SPEC §3.4 + §10 #6)
//
// 每次跑产生一个新文件, 不覆盖历史.

import * as fs from "fs"
import * as path from "path"
import type { Finding } from "../types/finding"

export class FindingsWriter {
  private filePath: string

  constructor(private readonly basePath: string) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    this.filePath = path.join(basePath, "findings", `${ts}.jsonl`)
  }

  write(findings: Finding[]): { path: string; count: number } {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const lines = findings.map((f) => JSON.stringify(f)).join("\n")
    fs.writeFileSync(this.filePath, lines + (lines ? "\n" : ""), "utf8")
    return { path: this.filePath, count: findings.length }
  }

  getPath(): string {
    return this.filePath
  }
}
