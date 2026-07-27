import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { readFile, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = resolve(apiRoot, '..', '..', 'node_modules')
const database = resolve(apiRoot, 'prisma', 'web-e2e.db')
const migrationsRoot = resolve(apiRoot, 'prisma', 'migrations')
const databaseUrl = `file:${database.replaceAll('\\', '/')}`
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DEMO_SEED_PASSWORD: 'BertDemoPassphrase2026!',
  DISABLE_JOB_WORKER: 'true',
}

for (const suffix of ['', '-shm', '-wal', '-journal']) {
  await rm(`${database}${suffix}`, { force: true })
}

function run(entry: string, args: string[]): void {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env: environment,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`Web E2E database preparation failed with exit code ${result.status ?? 1}`)
}

const migrationDatabase = new Database(database)
try {
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const migration of migrations) {
    migrationDatabase.exec(await readFile(resolve(migrationsRoot, migration.name, 'migration.sql'), 'utf8'))
  }
} finally {
  migrationDatabase.close()
}

run(resolve(nodeModules, 'tsx', 'dist', 'cli.mjs'), ['prisma/seed.ts'])
