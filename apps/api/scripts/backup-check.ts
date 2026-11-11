// Fails (exit code 1) when the newest complete backup in BACKUP_DIR is older than
// BACKUP_MAX_AGE_HOURS (default 2) or when there is none. Run hourly by
// deploy/systemd/lankadws-backup-check.timer; it reads manifests only and changes nothing.
import '../src/config/load-env.js'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getConfig } from '../src/config/config.js'

const root = resolve(getConfig().BACKUP_DIR)
const maxAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 2)
if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
  console.error('BACKUP_MAX_AGE_HOURS must be a positive number')
  process.exit(1)
}

let newest: Date | null = null
try {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(await readFile(join(root, entry.name, 'manifest.json'), 'utf8')) as { createdAt?: string }
      const createdAt = new Date(manifest.createdAt ?? '')
      if (!Number.isNaN(createdAt.getTime()) && (!newest || createdAt > newest)) newest = createdAt
    } catch { /* A directory without a readable manifest is an incomplete copy. */ }
  }
} catch {
  console.error(`Backup directory ${root} is not readable`)
  process.exit(1)
}

if (!newest) {
  console.error(`No complete backup in ${root}`)
  process.exit(1)
}
const ageHours = (Date.now() - newest.getTime()) / 3_600_000
if (ageHours > maxAgeHours) {
  console.error(`Latest backup is ${ageHours.toFixed(1)} h old (${newest.toISOString()}); the limit is ${maxAgeHours} h`)
  process.exit(1)
}
console.log(`Latest backup ${newest.toISOString()} (${ageHours.toFixed(1)} h old)`)
