// 增量 cache: 记录哪些 session_id 已处理过 + 上次 run 时间
//
// SPEC §3.7 hybrid: cache + 时间窗双保险
// - 主路: cache miss → 不处理(已处理过)
// - 兜底: cache 损坏 → 用 config.incremental.fallback_window 回退

import * as fs from "fs"
import * as path from "path"

interface CacheData {
  /** ISO 8601, 上一次成功跑完的时间 */
  last_run_at: string | null
  /** session_id → 处理时间(ISO) */
  processed: Record<string, string>
  schema_version: 1
}

export class ProcessedTracker {
  private data: CacheData
  constructor(private readonly cachePath: string) {
    this.data = this.load()
  }

  private load(): CacheData {
    if (!fs.existsSync(this.cachePath)) {
      return { last_run_at: null, processed: {}, schema_version: 1 }
    }
    try {
      const raw = fs.readFileSync(this.cachePath, "utf8")
      return JSON.parse(raw) as CacheData
    } catch {
      // cache 损坏 → 重置
      // eslint-disable-next-line no-console
      console.warn(`[skill-recall] cache corrupt, reset: ${this.cachePath}`)
      return { last_run_at: null, processed: {}, schema_version: 1 }
    }
  }

  isProcessed(sessionId: string): boolean {
    return sessionId in this.data.processed
  }

  markProcessed(sessionId: string): void {
    this.data.processed[sessionId] = new Date().toISOString()
  }

  getLastRunAt(): string | null {
    return this.data.last_run_at
  }

  markRunComplete(): void {
    this.data.last_run_at = new Date().toISOString()
    this.save()
  }

  reset(): void {
    this.data = { last_run_at: null, processed: {}, schema_version: 1 }
    this.save()
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true })
    fs.writeFileSync(this.cachePath, JSON.stringify(this.data, null, 2), "utf8")
  }
}
