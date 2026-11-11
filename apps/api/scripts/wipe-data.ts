// Removes the SQLite database and all stored/quarantined/temporary files, so the next
// `prisma migrate deploy` starts from an empty database. Backups are not touched.
// Run it with the API stopped: `npm run db:wipe`. It asks to type WIPE; LANKADWS_WIPE_CONFIRM=WIPE skips the
// question for scripted development resets.
import '../src/config/load-env.js'
import { readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
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

/** True when an API process answers on the configured port, i.e. it still holds the database. */
async function apiIsRunning(host: string, port: number): Promise<boolean> {
  const address = host === '0.0.0.0' ? '127.0.0.1' : host
  try {
    const response = await fetch(`http://${address}:${port}/api/v1/health/live`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

const config = getConfig()
const database = databasePath()
const directories = [config.FILE_STORAGE_DIR, config.FILE_QUARANTINE_DIR, config.FILE_TEMP_DIR].map((dir) => resolve(dir))

if (await apiIsRunning(config.HOST, config.PORT)) {
  console.error(`The API answers on port ${config.PORT}. Stop it first (systemctl stop lankadws), then run db:wipe again.`)
  process.exit(1)
}

console.log('This permanently deletes:')
console.log(`  database ${database}`)
for (const path of directories) console.log(`  every file in ${path}`)
console.log('Backups are kept.')
if (process.env.LANKADWS_WIPE_CONFIRM !== 'WIPE') {
  if (!process.stdin.isTTY) {
    console.error('Refusing to wipe without a terminal. Run it interactively or set LANKADWS_WIPE_CONFIRM=WIPE.')
    process.exit(1)
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question('Type WIPE to continue: ')
  prompt.close()
  if (answer.trim() !== 'WIPE') {
    console.log('Nothing was deleted.')
    process.exit(1)
  }
}

for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(`${database}${suffix}`, { force: true })
console.log(`Deleted database ${database}`)
for (const path of directories) console.log(`Emptied ${path} (${await emptyDirectory(path)} entries)`)
