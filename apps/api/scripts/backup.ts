import 'dotenv/config'
import Database from 'better-sqlite3'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfig } from '../src/config/config.js'
import { databasePath, encryptTo, encryptedFilePath, type BackupManifest, walk } from './backup-lib.js'

async function rotateBackups(rootInput: string, current: string): Promise<number> {
  const root = resolve(rootInput)
  const records: Array<{ path: string; createdAt: Date }> = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = resolve(root, entry.name)
    try {
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as { createdAt?: string }
      const createdAt = new Date(manifest.createdAt ?? '')
      if (!Number.isNaN(createdAt.getTime())) records.push({ path, createdAt })
    } catch { /* Incomplete/foreign directories are preserved for operator review. */ }
  }
  records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const keep = new Set<string>([resolve(current)])
  const daily = new Set<string>()
  const monthly = new Set<string>()
  for (const record of records) {
    const day = record.createdAt.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    if (daily.size < getConfig().BACKUP_KEEP_DAILY && !daily.has(day)) { daily.add(day); keep.add(record.path) }
    if (monthly.size < getConfig().BACKUP_KEEP_MONTHLY && !monthly.has(month)) { monthly.add(month); keep.add(record.path) }
  }
  let removed = 0
  for (const record of records) {
    if (keep.has(record.path)) continue
    if (record.path === root || !record.path.startsWith(`${root}${sep}`)) throw new Error('Backup rotation path escaped backup root')
    await rm(record.path, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const target = resolve(getConfig().BACKUP_DIR, stamp)
  const tempDb = join(target, 'database.sqlite.tmp')
  await mkdir(target, { recursive: true })
  const db = new Database(databasePath(), { readonly: true, fileMustExist: true })
  try { await db.backup(tempDb) } finally { db.close() }
  const database = await encryptTo(tempDb, join(target, 'database.sqlite.enc'))
  await rm(tempDb, { force: true })
  const files = []
  for (const source of await walk(getConfig().FILE_STORAGE_DIR)) files.push(await encryptTo(source, encryptedFilePath(target, getConfig().FILE_STORAGE_DIR, source)))
  const manifest: BackupManifest = { version: 1, createdAt: new Date().toISOString(), database, files, correlationId: randomUUID() }
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  const removed = await rotateBackups(getConfig().BACKUP_DIR, target)
  console.log(`Encrypted backup created: ${target}; rotated copies: ${removed}`)
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Backup failed'); process.exitCode = 1 })
