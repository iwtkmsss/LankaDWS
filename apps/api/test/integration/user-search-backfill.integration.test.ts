import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const database = resolve('prisma/web-e2e.db')
const databaseUrl = `file:${database.replaceAll('\\', '/')}`
const tsx = resolve('../../node_modules/tsx/dist/cli.mjs')

function run(entry: string) {
  return spawnSync(process.execPath, [tsx, entry], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      DEMO_SEED_PASSWORD: 'BertDemoPassphrase2026!',
      DISABLE_JOB_WORKER: 'true',
    },
  })
}

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    rmSync(`${database}${suffix}`, { force: true })
  }
})

describe('user search migration backfill', () => {
  it('normalizes existing rows and is idempotent', () => {
    const prepared = run('scripts/prepare-web-e2e.ts')
    expect(prepared.status, prepared.stderr).toBe(0)

    const db = new Database(database)
    try {
      db.prepare(`
        UPDATE "User"
        SET "displayName" = ?, "normalizedDisplayName" = ?
        WHERE "id" = ?
      `).run('  ＯＬＥＮＡ   БОНДАР  ', 'stale', 'usr_olena')
    } finally {
      db.close()
    }

    const first = run('scripts/backfill-user-search.ts')
    const second = run('scripts/backfill-user-search.ts')
    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)

    const verified = new Database(database, { readonly: true })
    try {
      expect(verified.prepare(`
        SELECT "normalizedDisplayName"
        FROM "User"
        WHERE "id" = ?
      `).get('usr_olena')).toEqual({ normalizedDisplayName: 'olena бондар' })
    } finally {
      verified.close()
    }
  }, 30_000)
})
