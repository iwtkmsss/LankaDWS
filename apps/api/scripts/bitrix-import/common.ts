// Shared helpers of the one-off Bitrix24 → LankaDWS import (docs/migration/bitrix24/import-script.md).
// Real data never lives in the repository: every path here comes from arguments or environment.
import { createReadStream, existsSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { join } from 'node:path'

export const COMPANY_ID = 'cmp_b24'
export const ENTITY_FILES = [
  'users',
  'departments',
  'user_departments',
  'groups',
  'group_members',
  'chats',
  'chat_members',
  'messages',
  'message_likes',
  'tasks',
  'task_members',
  'task_checklist',
  'task_comments',
  'blog_posts',
  'blog_post_reads',
  'blog_comments',
  'calendar_events',
] as const
export type EntityFile = (typeof ENTITY_FILES)[number]

export function ndjsonPath(dir: string, entity: EntityFile): string {
  return join(dir, `${entity}.ndjson.gz`)
}

/** Parses `--name value` / `--flag` command-line options. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const options = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const equals = arg.indexOf('=')
    if (equals > 0) {
      options.set(arg.slice(2, equals), arg.slice(equals + 1))
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      options.set(arg.slice(2), next)
      index += 1
    } else {
      options.set(arg.slice(2), true)
    }
  }
  return options
}

export function stringOption(options: Map<string, string | true>, name: string, env?: string): string | undefined {
  const value = options.get(name)
  if (typeof value === 'string' && value.trim()) return value.trim()
  const fromEnv = env ? process.env[env]?.trim() : undefined
  return fromEnv || undefined
}

/**
 * Streams a gzip NDJSON file line by line. Lines are split on LF only: node:readline would also
 * split on U+2028/U+2029, which occur unescaped inside real Bitrix texts.
 */
export async function* readNdjson<Row>(path: string): AsyncGenerator<Row> {
  if (!existsSync(path)) throw new Error(`NDJSON file is missing: ${path}`)
  const input = createReadStream(path).pipe(createGunzip())
  input.setEncoding('utf8')
  let pending = ''
  for await (const chunk of input as AsyncIterable<string>) {
    pending += chunk
    let start = 0
    let newline = pending.indexOf('\n')
    while (newline >= 0) {
      const line = pending.slice(start, newline).replace(/\r$/, '')
      if (line) yield JSON.parse(line) as Row
      start = newline + 1
      newline = pending.indexOf('\n', start)
    }
    pending = pending.slice(start)
  }
  const last = pending.replace(/\r$/, '')
  if (last.trim()) yield JSON.parse(last) as Row
}

const MSK_OFFSET_MS = 3 * 3_600_000

/**
 * Bitrix stores naive server time (MSK, UTC+3 without DST since 2014). Returns the UTC instant in
 * the exact text format Prisma writes to SQLite (`2026-09-11T10:17:38.132+00:00`), or null.
 */
export function mskToIso(value: string | null | undefined): string | null {
  const date = mskToDate(value)
  return date ? isoForSqlite(date) : null
}

export function mskToDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number) as [number, number, number, number, number, number, number]
  if (year < 1971 || month < 1 || day < 1) return null
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - MSK_OFFSET_MS
  return Number.isNaN(utc) ? null : new Date(utc)
}

export function isoForSqlite(date: Date): string {
  return date.toISOString().replace('Z', '+00:00')
}

/** Fixed-width numeric part keeps id order equal to Bitrix order (the app breaks createdAt ties by id). */
export function padded(value: number | string): string {
  return String(value).padStart(10, '0')
}

export const ids = {
  user: (id: number) => `usr_b24_${id}`,
  usernameReservation: (id: number) => `unr_b24_${id}`,
  orgUnit: (id: number) => `org_b24_${id}`,
  orgAssignment: (userId: number, deptId: number) => `uoa_b24_${userId}_${deptId}`,
  project: (groupId: number) => `prj_b24_${groupId}`,
  chatThread: (chatId: number) => `thr_b24_${chatId}`,
  groupThread: (groupId: number) => `thr_b24_g${groupId}`,
  threadParticipant: (threadId: string, userId: number) => `tpart_b24_${threadId.slice('thr_b24_'.length)}_${userId}`,
  message: (id: number) => `msg_b24_${padded(id)}`,
  messageReaction: (paramId: number) => `mrx_b24_${paramId}`,
  messageMention: (messageId: number, index: number) => `mnt_b24_m${padded(messageId)}_${index}`,
  task: (id: number) => `tsk_b24_${id}`,
  taskParticipant: (taskId: number, userId: number) => `tpart_b24_t${taskId}_${userId}`,
  checklistItem: (id: number) => `tchk_b24_${id}`,
  taskComment: (id: number) => `cmt_b24_t${padded(id)}`,
  feedPost: (id: number) => `feed_b24_${id}`,
  feedComment: (id: number) => `cmt_b24_p${padded(id)}`,
  feedPostRecipient: (postId: number, key: string) => `frcp_b24_${postId}_${key}`,
  feedAckRecipient: (postId: number, userId: number) => `fackr_b24_${postId}_${userId}`,
  feedAck: (postId: number, userId: number) => `fack_b24_${postId}_${userId}`,
  feedSubscription: (postId: number, userId: string) => `fsub_b24_${postId}_${userId.replace('usr_b24_', '')}`,
  feedPostItem: (postId: number) => `fitem_b24_p${postId}`,
  feedPostHead: (postId: number) => `fhead_b24_p${postId}`,
  event: (id: number) => `evt_b24_${id}`,
  eventAudience: (id: number) => `evta_b24_${id}`,
}

export class Stats {
  private readonly entries = new Map<string, { source: number; imported: number; skipped: Record<string, number> }>()

  entry(name: string) {
    let entry = this.entries.get(name)
    if (!entry) {
      entry = { source: 0, imported: 0, skipped: {} }
      this.entries.set(name, entry)
    }
    return entry
  }

  source(name: string, count = 1): void { this.entry(name).source += count }
  imported(name: string, count = 1): void { this.entry(name).imported += count }
  skip(name: string, reason: string, count = 1): void {
    const entry = this.entry(name)
    entry.skipped[reason] = (entry.skipped[reason] ?? 0) + count
  }

  toJSON() { return Object.fromEntries(this.entries) }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  const seconds = ms / 1000
  if (seconds < 120) return `${seconds.toFixed(1)} s`
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}
