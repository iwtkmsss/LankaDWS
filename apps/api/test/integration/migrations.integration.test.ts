import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const testDb = resolve('test/tmp/baseline-migration/database.db')
const baseline = resolve('prisma/migrations/20260805000000_baseline/migration.sql')
let database: InstanceType<typeof Database> | undefined

beforeEach(() => {
  rmSync(dirname(testDb), { recursive: true, force: true })
  mkdirSync(dirname(testDb), { recursive: true })
  database = new Database(testDb)
  database.exec(readFileSync(baseline, 'utf8'))
})

afterEach(() => {
  database?.close()
  database = undefined
  rmSync(dirname(testDb), { recursive: true, force: true })
})

describe('baseline migration', () => {
  it('applies once to an empty SQLite database', () => {
    const row = database!.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get() as { count: number }
    expect(row.count).toBeGreaterThan(40)
  })

  it('contains only the approved account and company activity model', () => {
    const userColumns = database!.prepare("PRAGMA table_info('User')").all() as Array<{ name: string }>
    const companyColumns = database!.prepare("PRAGMA table_info('Company')").all() as Array<{ name: string }>
    expect(userColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['accountType', 'isActive', 'primaryCompanyId']))
    expect(companyColumns.map((column) => column.name)).toContain('isActive')
    expect(userColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining(['displayRole', 'status', 'mustChangePassword']))
  })

  it('allows workspace-owned avatar files without a company', () => {
    const fileColumns = database!.prepare("PRAGMA table_info('FileObject')").all() as Array<{ name: string; notnull: number }>
    expect(fileColumns.find((column) => column.name === 'companyId')?.notnull).toBe(0)
  })
})
