import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = resolve(apiRoot, '..', '..', 'node_modules')
const prismaCli = resolve(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
const database = resolve(apiRoot, 'prisma', 'web-e2e.db')
const databaseUrl = `file:${database.replaceAll('\\', '/')}`
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DEMO_SEED_PASSWORD: 'LankaDWSDemoPassphrase2026!',
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

run(prismaCli, ['migrate', 'deploy', '--config', 'prisma.config.ts'])
run(resolve(nodeModules, 'tsx', 'dist', 'cli.mjs'), ['prisma/seed.ts'])
