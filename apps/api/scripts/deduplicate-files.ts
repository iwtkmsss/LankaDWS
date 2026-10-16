import '../src/config/load-env.js'
import Database from 'better-sqlite3'
import { databasePath } from './backup-lib.js'
import { deduplicateCleanFile } from '../src/modules/files/storage.js'

interface StoredFile { id: string; workspaceId: string; storageKey: string; sha256: string; bytes: number }

async function main() {
  const apply = process.argv.includes('--apply')
  const db = new Database(databasePath(), { readonly: !apply, fileMustExist: true, timeout: 5000 })
  const totals = { mode: apply ? 'apply' : 'dry-run', duplicatePaths: 0, bytesReleased: 0, alreadyShared: 0, skipped: 0 }
  try {
    const rows = db.prepare(`SELECT f.id, f.workspaceId, f.storageKey, f.sha256, f.bytes
      FROM FileObject f JOIN (
        SELECT workspaceId, sha256, bytes FROM FileObject WHERE scanStatus = 'CLEAN'
        GROUP BY workspaceId, sha256, bytes HAVING COUNT(*) > 1
      ) d ON d.workspaceId = f.workspaceId AND d.sha256 = f.sha256 AND d.bytes = f.bytes
      WHERE f.scanStatus = 'CLEAN' ORDER BY f.workspaceId, f.sha256, f.bytes, f.id`).all() as StoredFile[]
    let source: StoredFile | undefined
    const current = db.prepare("SELECT id FROM FileObject WHERE id = ? AND workspaceId = ? AND storageKey = ? AND sha256 = ? AND bytes = ? AND scanStatus = 'CLEAN'")
    for (const target of rows) {
      if (!source || source.workspaceId !== target.workspaceId || source.sha256 !== target.sha256 || source.bytes !== target.bytes) {
        source = target
        continue
      }
      // Serialize with upload/discard/scan transactions; no metadata or permissions change.
      if (apply) db.exec('BEGIN IMMEDIATE')
      try {
        if (!current.get(source.id, source.workspaceId, source.storageKey, source.sha256, source.bytes)
          || !current.get(target.id, target.workspaceId, target.storageKey, target.sha256, target.bytes)) {
          totals.skipped++
          continue
        }
        const result = await deduplicateCleanFile(source.storageKey, target.storageKey, source.sha256, source.bytes, apply)
        if (result.duplicate) { totals.duplicatePaths++; totals.bytesReleased += result.bytesReleased }
        else totals.alreadyShared++
      } catch (error) {
        totals.skipped++
        console.error(JSON.stringify({ fileId: target.id, error: error instanceof Error ? error.message : 'deduplication_failed' }))
      } finally {
        if (apply) db.exec('COMMIT')
      }
    }
    console.log(JSON.stringify(totals))
    if (totals.skipped) process.exitCode = 1
  } finally {
    db.close()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Deduplication failed'); process.exitCode = 1 })
