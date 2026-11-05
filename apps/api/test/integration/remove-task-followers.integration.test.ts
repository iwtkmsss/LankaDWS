import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('removes task subscriptions and their idempotency results while preserving tasks, observers, personal state and reminders', () => {
  const database = new Database(':memory:')
  const migrations = resolve('prisma/migrations')
  const removal = '20261022130000_remove_task_followers'
  try {
    for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name < removal).sort((a, b) => a.name.localeCompare(b.name))) {
      database.exec(readFileSync(resolve(migrations, entry.name, 'migration.sql'), 'utf8'))
    }
    database.pragma('foreign_keys = ON')
    database.exec(`
      INSERT INTO "Workspace" ("id", "displayName", "updatedAt") VALUES ('workspace', 'Workspace', CURRENT_TIMESTAMP);
      INSERT INTO "Company" ("id", "workspaceId", "displayName", "legalName", "code", "updatedAt")
        VALUES ('company', 'workspace', 'Company', 'Company', 'company', CURRENT_TIMESTAMP);
      INSERT INTO "User" ("id", "workspaceId", "primaryCompanyId", "displayName", "normalizedDisplayName", "username", "normalizedUsername", "updatedAt")
        VALUES ('person', 'workspace', 'company', 'Person', 'person', 'person', 'person', CURRENT_TIMESTAMP);
      INSERT INTO "Task" ("id", "workspaceId", "companyId", "number", "title", "createdById", "reporterId", "updatedAt")
        VALUES ('task', 'workspace', 'company', '990001', 'Task', 'person', 'person', CURRENT_TIMESTAMP);
      INSERT INTO "TaskParticipant" ("id", "taskId", "userId", "role", "addedById", "updatedAt") VALUES ('observer', 'task', 'person', 'WATCHER', 'person', CURRENT_TIMESTAMP);
      INSERT INTO "TaskFollower" ("id", "taskId", "userId") VALUES ('subscription', 'task', 'person');
      INSERT INTO "TaskUserState" ("id", "taskId", "userId", "favoritedAt", "important", "updatedAt")
        VALUES ('state', 'task', 'person', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP);
      INSERT INTO "TaskReminder" ("id", "taskId", "userId", "triggerType", "remindAt", "updatedAt")
        VALUES ('reminder', 'task', 'person', 'AT', '2030-01-01', CURRENT_TIMESTAMP);
      INSERT INTO "IdempotencyRecord" ("id", "userId", "key", "operation", "requestFingerprint", "resultType", "resultId", "expiresAt") VALUES
        ('obsolete', 'person', 'old', 'task.follower.add:task', 'hash', 'TASK_FOLLOWER', 'subscription', '2030-01-01'),
        ('retained', 'person', 'current', 'task.user-state:task', 'hash', 'TASK_USER_STATE', 'state', '2030-01-01');
    `)
    database.transaction(() => database.exec(readFileSync(resolve(migrations, removal, 'migration.sql'), 'utf8')))()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'TaskFollower'").get()).toBeUndefined()
    expect(database.prepare('SELECT id FROM "IdempotencyRecord"').all()).toEqual([{ id: 'retained' }])
    for (const table of ['Task', 'User', 'TaskParticipant', 'TaskUserState', 'TaskReminder']) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()).toEqual({ count: 1 })
    }
    expect(database.pragma('foreign_key_check')).toEqual([])
  } finally {
    database.close()
  }
})
