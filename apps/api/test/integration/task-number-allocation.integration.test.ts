import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PrismaClient } from '../../src/generated/prisma/client.js'
import { TaskNumberAllocator } from '../../src/prisma/task-number-allocator.js'

const testRoot = resolve('test/tmp/task-number-allocation')
const baseline = resolve('prisma/migrations/20260805000000_baseline/migration.sql')
const taskNumbersMigration = resolve(
  'prisma/migrations/20260811160000_numeric_task_numbers/migration.sql',
)
const clients: PrismaClient[] = []

function createDatabase(name: string): string {
  const databasePath = resolve(testRoot, name)
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.exec(readFileSync(baseline, 'utf8'))
  database.close()
  return databasePath
}

function prismaFor(databasePath: string): PrismaClient {
  const url = `file:${databasePath.replaceAll('\\', '/')}`
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  clients.push(client)
  return client
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()))
  rmSync(testRoot, { recursive: true, force: true })
})

describe('numeric immutable task numbers', () => {
  it('backfills legacy values deterministically and keeps them searchable as aliases', () => {
    const databasePath = createDatabase('migration.db')
    const database = new Database(databasePath)
    database.exec(`
      INSERT INTO "Workspace" ("id", "displayName", "updatedAt")
      VALUES ('wrk_1', 'Workspace', CURRENT_TIMESTAMP);
      INSERT INTO "Company" (
        "id", "workspaceId", "displayName", "legalName", "code", "updatedAt"
      ) VALUES (
        'cmp_1', 'wrk_1', 'Company', 'Company LLC', 'company', CURRENT_TIMESTAMP
      );
      INSERT INTO "User" (
        "id", "workspaceId", "primaryCompanyId", "displayName",
        "normalizedDisplayName", "username", "normalizedUsername", "updatedAt"
      ) VALUES (
        'usr_1', 'wrk_1', 'cmp_1', 'User', 'user', 'user', 'user', CURRENT_TIMESTAMP
      );
      INSERT INTO "Task" (
        "id", "workspaceId", "companyId", "number", "title", "createdById",
        "reporterId", "createdAt", "updatedAt"
      ) VALUES
        ('tsk_numeric', 'wrk_1', 'cmp_1', '2402', 'Numeric', 'usr_1', 'usr_1', '2026-01-01', CURRENT_TIMESTAMP),
        ('tsk_preferred', 'wrk_1', 'cmp_1', 'TSK-2401', 'Preferred', 'usr_1', 'usr_1', '2026-01-02', CURRENT_TIMESTAMP),
        ('tsk_collision', 'wrk_1', 'cmp_1', 'TSK-2402', 'Collision', 'usr_1', 'usr_1', '2026-01-03', CURRENT_TIMESTAMP),
        ('tsk_opaque', 'wrk_1', 'cmp_1', 'TSK-OLD-A', 'Opaque', 'usr_1', 'usr_1', '2026-01-04', CURRENT_TIMESTAMP);
    `)

    database.exec(readFileSync(taskNumbersMigration, 'utf8'))

    const tasks = database.prepare(
      'SELECT "id", "number" FROM "Task" ORDER BY "id"',
    ).all() as Array<{ id: string; number: string }>
    expect(tasks).toEqual([
      { id: 'tsk_collision', number: '2403' },
      { id: 'tsk_numeric', number: '2402' },
      { id: 'tsk_opaque', number: '2404' },
      { id: 'tsk_preferred', number: '2401' },
    ])
    expect(tasks.every((task) => /^\d+$/.test(task.number))).toBe(true)

    const aliasedTask = database.prepare(`
      SELECT "Task"."id"
      FROM "Task"
      JOIN "TaskNumberAlias" ON "TaskNumberAlias"."taskId" = "Task"."id"
      WHERE "TaskNumberAlias"."legacyNumber" = ?
    `).get('TSK-2402') as { id: string }
    expect(aliasedTask.id).toBe('tsk_collision')
    expect(database.prepare(`
      SELECT "lastNumber" FROM "TaskNumberSequence" WHERE "scope" = 'global'
    `).get()).toEqual({ lastNumber: 2404 })

    expect(() => database.prepare(`
      INSERT INTO "Task" (
        "id", "workspaceId", "companyId", "number", "title", "createdById",
        "reporterId", "updatedAt"
      ) VALUES ('tsk_invalid', 'wrk_1', 'cmp_1', 'TSK-NEW', 'Invalid', 'usr_1', 'usr_1', CURRENT_TIMESTAMP)
    `).run()).toThrow(/only digits/)
    expect(() => database.prepare(
      `UPDATE "Task" SET "number" = '9999' WHERE "id" = 'tsk_preferred'`,
    ).run()).toThrow(/immutable/)
    database.close()
  })

  it('serializes concurrent allocation and rolls the sequence back with its transaction', async () => {
    const databasePath = createDatabase('concurrency.db')
    const database = new Database(databasePath)
    database.exec(readFileSync(taskNumbersMigration, 'utf8'))
    database.close()

    const allocator = new TaskNumberAllocator()
    const pool = Array.from({ length: 4 }, () => prismaFor(databasePath))
    await Promise.all(pool.map(async (client) => {
      await client.$connect()
      await client.$executeRawUnsafe('PRAGMA journal_mode = WAL')
      await client.$executeRawUnsafe('PRAGMA busy_timeout = 10000')
    }))

    const allocated = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      allocator.runInTransaction(
        pool[index % pool.length],
        (_tx, number) => Promise.resolve(number),
      )
    )))
    expect(new Set(allocated).size).toBe(20)
    expect(allocated.every((number) => /^\d+$/.test(number))).toBe(true)
    expect(allocated.map(BigInt).sort((left, right) => left < right ? -1 : 1)).toEqual(
      Array.from({ length: 20 }, (_, index) => BigInt(index + 1)),
    )

    await expect(allocator.runInTransaction(pool[0], (_tx, number) => {
      expect(number).toBe('21')
      return Promise.reject(new Error('force rollback'))
    })).rejects.toThrow('force rollback')
    await expect(allocator.runInTransaction(
      pool[1],
      (_tx, number) => Promise.resolve(number),
    )).resolves.toBe('21')
  })
})
