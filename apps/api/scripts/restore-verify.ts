import '../src/config/load-env.js'
import Database from 'better-sqlite3'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getConfig } from '../src/config/config.js'
import { checksum, decrypt, type BackupManifest } from './backup-lib.js'

async function latestBackup(): Promise<string> {
  const named = process.argv[2]
  if (named) return resolve(named)
  const entries = (await readdir(getConfig().BACKUP_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const last = entries.at(-1)
  if (!last) throw new Error('No backup directory found')
  return resolve(getConfig().BACKUP_DIR, last)
}

async function main(): Promise<void> {
  const backup = await latestBackup()
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as BackupManifest
  const verifyRoot = resolve(backup, '.restore-verify')
  await rm(verifyRoot, { recursive: true, force: true })
  await mkdir(verifyRoot, { recursive: true })
  try {
    const dbBytes = decrypt(await readFile(join(backup, 'database.sqlite.enc')))
    if (checksum(dbBytes) !== manifest.database.sha256) throw new Error('Database checksum mismatch')
    const dbPath = join(verifyRoot, 'database.sqlite')
    await writeFile(dbPath, dbBytes)
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const integrity = db.pragma('integrity_check', { simple: true }) as string
      if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
      const migrations = db.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL').get() as { count: number }
      const users = db.prepare('SELECT COUNT(*) AS count FROM User').get() as { count: number }
      if (!migrations.count || users.count < 0) throw new Error('Restore smoke check failed')
    } finally { db.close() }
    for (const file of manifest.files) {
      const bytes = decrypt(await readFile(file.encrypted))
      if (checksum(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`File checksum mismatch: ${file.encrypted}`)
    }
    console.log(`Restore verification passed: ${manifest.correlationId}`)
  } finally {
    await rm(verifyRoot, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Restore verification failed'); process.exitCode = 1 })
