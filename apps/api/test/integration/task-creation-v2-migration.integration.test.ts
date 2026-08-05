import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const testDb = resolve('test/tmp/task-baseline/database.db')
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

describe('clean task baseline', () => {
  it('creates the current task model without legacy access tables', () => {
    const tables = database!.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const names = new Set(tables.map((table) => table.name))
    expect(names.has('Task')).toBe(true)
    expect(names.has('TaskParticipant')).toBe(true)
    expect(names.has('UserCompanyAccess')).toBe(false)
    expect(names.has('Role')).toBe(false)
    expect(names.has('Permission')).toBe(false)
  })

  it('uses boolean account activity and account type on users', () => {
    const columns = database!.prepare("PRAGMA table_info('User')").all() as Array<{ name: string }>
    const names = new Set(columns.map((column) => column.name))
    expect(names.has('accountType')).toBe(true)
    expect(names.has('isActive')).toBe(true)
    expect(names.has('displayRole')).toBe(false)
    expect(names.has('status')).toBe(false)
    expect(names.has('mustChangePassword')).toBe(false)
  })
})
