import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const testDb = resolve('test/tmp/migrations.db')
let openDatabase: InstanceType<typeof Database> | undefined

beforeEach(() => rmSync(dirname(testDb), { recursive: true, force: true }))

afterEach(() => {
  openDatabase?.close()
  openDatabase = undefined
  rmSync(dirname(testDb), { recursive: true, force: true })
})

describe('ordered SQLite migrations', () => {
  it('create an append-only audit table and FTS5 index from an empty database', () => {
    mkdirSync(dirname(testDb), { recursive: true })
    const db = new Database(testDb)
    openDatabase = db
    const init = readFileSync(resolve('prisma/migrations/20260715112458_init/migration.sql'), 'utf8')
    const guards = readFileSync(resolve('prisma/migrations/20260715113000_platform_guards/migration.sql'), 'utf8')
    const keyVersion = readFileSync(resolve('prisma/migrations/20260715130000_private_key_version/migration.sql'), 'utf8')
    db.exec(init)
    db.exec(guards)
    db.exec(keyVersion)
    expect(db.prepare("SELECT name FROM pragma_table_info('RequestPrivateDetail') WHERE name = 'keyVersion'").get()).toEqual({ name: 'keyVersion' })
    db.prepare('INSERT INTO AuditEvent (id, workspaceId, actorType, action, entityType, entityId, result, risk, correlationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('aud_test', 'ws_test', 'SYSTEM', 'test.created', 'TEST', 'entity', 'SUCCESS', 'NORMAL', 'corr_test')
    expect(() => db.prepare('UPDATE AuditEvent SET result = ? WHERE id = ?').run('FAILURE', 'aud_test')).toThrow(/append[_-]only/i)
    expect(() => db.prepare('DELETE FROM AuditEvent WHERE id = ?').run('aud_test')).toThrow(/append[_-]only/i)
    db.prepare('INSERT INTO SearchIndex (entityType, entityId, workspaceId, companyId, title, body) VALUES (?, ?, ?, ?, ?, ?)').run('ARTICLE', 'art_test', 'ws_test', 'cmp_test', 'Політика відпусток', 'Як оформити відсутність')
    expect(db.prepare("SELECT entityId FROM SearchIndex WHERE SearchIndex MATCH 'відпусток'").get()).toEqual({ entityId: 'art_test' })
  })

  it('bounds writer contention with SQLITE_BUSY and remains writable after the lock is released', () => {
    mkdirSync(dirname(testDb), { recursive: true })
    const first = new Database(testDb)
    const second = new Database(testDb)
    openDatabase = first
    try {
      first.pragma('journal_mode = WAL')
      first.exec('CREATE TABLE BusyProbe (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      first.exec('BEGIN IMMEDIATE')
      first.prepare('INSERT INTO BusyProbe (id, value) VALUES (?, ?)').run('one', 'held')
      second.pragma('busy_timeout = 25')
      expect(() => second.prepare('INSERT INTO BusyProbe (id, value) VALUES (?, ?)').run('two', 'blocked')).toThrow(/busy|locked/i)
      first.exec('COMMIT')
      second.prepare('INSERT INTO BusyProbe (id, value) VALUES (?, ?)').run('two', 'released')
      expect(second.prepare('SELECT COUNT(*) AS count FROM BusyProbe').get()).toEqual({ count: 2 })
    } finally {
      if (first.inTransaction) first.exec('ROLLBACK')
      second.close()
    }
  })
})
