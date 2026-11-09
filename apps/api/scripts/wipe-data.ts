// Removes the SQLite database and all stored/quarantined/temporary files, so the next
// `prisma migrate deploy` starts from an empty database. Backups are not touched.
// Run it with the API stopped: `npm run db:wipe`.
import '../src/config/load-env.js'
import { readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getConfig } from '../src/config/config.js'
import { databasePath } from './backup-lib.js'

async function emptyDirectory(path: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch {
    return 0
  }
  for (const entry of entries) await rm(join(path, entry), { recursive: true, force: true })
  return entries.length
}

const config = getConfig()
const database = databasePath()
for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(`${database}${suffix}`, { force: true })
console.log(`Deleted database ${database}`)
for (const dir of [config.FILE_STORAGE_DIR, config.FILE_QUARANTINE_DIR, config.FILE_TEMP_DIR]) {
  const path = resolve(dir)
  console.log(`Emptied ${path} (${await emptyDirectory(path)} entries)`)
}
