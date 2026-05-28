// Append-only 落原始 jsonl 到 sessions/ (SPEC §3.8 + §10 #9)
//
// 路径: <base>/sessions/<agent>/<yyyy>/<mm>/<dd>/<session-id>.jsonl
//
// 关键纪律:
// - sessions/ 永不编辑、永不删除
// - 已存在的文件直接跳过(append-only 语义: 同 session_id 只写一次)

import * as fs from "fs"
import * as path from "path"
import type { SessionDetail } from "../types/session"

export class SessionArchiver {
  constructor(
    private readonly basePath: string,
    private readonly enabled: boolean
  ) {}

  /** 把一个 session 的 events 写成 jsonl(每行一个 event), 已存在则跳过 */
  archive(session: SessionDetail): { archived: boolean; path: string | null } {
    if (!this.enabled) return { archived: false, path: null }

    const archivePath = this.pathFor(session)

    // 已存在 = append-only 不动
    if (fs.existsSync(archivePath)) {
      return { archived: false, path: archivePath }
    }

    fs.mkdirSync(path.dirname(archivePath), { recursive: true })
    const lines = session.events.map((e) => JSON.stringify(e)).join("\n")
    fs.writeFileSync(archivePath, lines + "\n", "utf8")
    return { archived: true, path: archivePath }
  }

  private pathFor(session: SessionDetail): string {
    const dateStr = session.modified_at || session.start_time || new Date().toISOString()
    const d = new Date(dateStr)
    const yyyy = String(d.getUTCFullYear())
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(d.getUTCDate()).padStart(2, "0")
    return path.join(
      this.basePath,
      "sessions",
      session.source,
      yyyy,
      mm,
      dd,
      `${session.id}.jsonl`
    )
  }
}
