import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const testDb = resolve('test/tmp/task-creation-v2-migration/database.db')
const migrationRoot = resolve('prisma/migrations')
const taskV2Migration = '20260729120000_task_creation_v2'
let openDatabase: InstanceType<typeof Database> | undefined

beforeEach(() => rmSync(dirname(testDb), { recursive: true, force: true }))

afterEach(() => {
  openDatabase?.close()
  openDatabase = undefined
  rmSync(dirname(testDb), { recursive: true, force: true })
})

function applyLegacyMigrations(db: InstanceType<typeof Database>) {
  const migrations = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < taskV2Migration)
    .map((entry) => entry.name)
    .sort()
  for (const migration of migrations) {
    db.exec(readFileSync(resolve(migrationRoot, migration, 'migration.sql'), 'utf8'))
  }
}

function seedLegacyTaskData(db: InstanceType<typeof Database>) {
  db.prepare('INSERT INTO Workspace (id, displayName, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('ws_task_v2', 'Task V2')
  db.prepare('INSERT INTO Company (id, workspaceId, displayName, legalName, code, timezone, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run('cmp_task_v2', 'ws_task_v2', 'Task V2', 'Task V2 LLC', 'TV2', 'Europe/Kyiv')
  for (const [id, username] of [
    ['usr_task_creator', 'task.creator'],
    ['usr_task_responsible', 'task.responsible'],
    ['usr_task_collaborator', 'task.collaborator'],
    ['usr_task_auditor', 'task.auditor'],
  ]) {
    db.prepare("INSERT INTO User (id, workspaceId, primaryCompanyId, displayName, username, normalizedUsername, displayRole, status, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 'Employee', 'ACTIVE', CURRENT_TIMESTAMP)")
      .run(id, 'ws_task_v2', 'cmp_task_v2', username, username, username)
    db.prepare('INSERT INTO UserCompanyAccess (id, userId, companyId) VALUES (?, ?, ?)')
      .run(`uca_${id}`, id, 'cmp_task_v2')
  }

  db.prepare("INSERT INTO Permission (code, domain, description) VALUES ('tasks.create', 'tasks', 'Create tasks')")
    .run()
  db.prepare("INSERT INTO Permission (code, domain, description) VALUES ('tasks.manage', 'tasks', 'Manage tasks')")
    .run()
  db.prepare("INSERT INTO Role (id, workspaceId, name, normalizedName, isFullAdmin, updatedAt) VALUES ('role_task_manager', 'ws_task_v2', 'Task manager', 'task manager', false, CURRENT_TIMESTAMP)")
    .run()
  db.prepare("INSERT INTO RolePermission (id, roleId, permissionCode, scope) VALUES ('rp_task_create', 'role_task_manager', 'tasks.create', 'OWN')")
    .run()
  db.prepare("INSERT INTO RolePermission (id, roleId, permissionCode, scope) VALUES ('rp_task_manage', 'role_task_manager', 'tasks.manage', 'ALL_COMPANIES')")
    .run()

  db.prepare("INSERT INTO Task (id, workspaceId, companyId, number, title, creatorId, assigneeId, status, priority, deadline, recurrenceKey, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 'CRITICAL', ?, ?, CURRENT_TIMESTAMP)")
    .run(
      'task_v2_template',
      'ws_task_v2',
      'cmp_task_v2',
      'TSK-V2-1',
      'Legacy template',
      'usr_task_creator',
      'usr_task_responsible',
      '2029-12-31T09:00:00.000Z',
      'series:task_v2_template',
    )
  db.prepare("INSERT INTO Task (id, workspaceId, companyId, number, title, creatorId, assigneeId, status, priority, deadline, recurrenceKey, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', 'HIGH', ?, ?, CURRENT_TIMESTAMP)")
    .run(
      'task_v2_occurrence',
      'ws_task_v2',
      'cmp_task_v2',
      'TSK-V2-2',
      'Legacy occurrence',
      'usr_task_creator',
      'usr_task_responsible',
      '2030-01-31T09:00:00.000Z',
      'series:task_v2_template:2030-01-31T09:00:00.000Z',
    )
  db.prepare("INSERT INTO AuditEvent (id, workspaceId, companyId, actorType, actorId, action, entityType, entityId, result, risk, correlationId) VALUES (?, ?, ?, 'USER', ?, 'task.created', 'TASK', ?, 'SUCCESS', 'NORMAL', ?)")
    .run('aud_task_v2_created', 'ws_task_v2', 'cmp_task_v2', 'usr_task_auditor', 'task_v2_template', 'corr_task_v2')
  db.prepare("INSERT INTO TaskParticipant (id, taskId, userId, role, addedById) VALUES (?, ?, ?, 'CO_EXECUTOR', ?)")
    .run('tpart_task_v2_collaborator', 'task_v2_template', 'usr_task_collaborator', 'usr_task_creator')
  db.prepare("INSERT INTO TaskChecklistItem (id, taskId, position, text, isDone, version) VALUES (?, ?, 1000, ?, true, 2)")
    .run('tcheck_task_v2', 'task_v2_template', 'Legacy checklist')
  db.prepare("INSERT INTO TaskReminder (id, taskId, userId, remindAt, updatedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
    .run('trm_task_v2', 'task_v2_template', 'usr_task_responsible', '2029-12-30T09:00:00.000Z')
  db.prepare("INSERT INTO BackgroundJob (id, type, entityType, entityId, safePayload, runAt, idempotencyKey, updatedAt) VALUES (?, 'task.recurrence', 'TASK', ?, ?, ?, ?, CURRENT_TIMESTAMP)")
    .run(
      'job_task_v2_recurrence',
      'task_v2_template',
      JSON.stringify({
        seriesKey: 'series:task_v2_template',
        frequency: 'MONTHLY',
        interval: 1,
        occurrenceAt: '2030-02-28T09:00:00.000Z',
        until: '2030-12-31T09:00:00.000Z',
      }),
      '2030-02-28T09:00:00.000Z',
      'recurrence:series:task_v2_template:2030-02-28T09:00:00.000Z',
    )
}

describe('task creation v2 migration', () => {
  it('backfills legacy task data and installs recursive task guards', () => {
    mkdirSync(dirname(testDb), { recursive: true })
    const db = new Database(testDb)
    openDatabase = db
    applyLegacyMigrations(db)
    seedLegacyTaskData(db)

    db.exec(readFileSync(resolve(migrationRoot, taskV2Migration, 'migration.sql'), 'utf8'))

    expect(db.prepare("SELECT createdById, reporterId, priority, dueAt FROM Task WHERE id = 'task_v2_template'").get())
      .toEqual({
        createdById: 'usr_task_auditor',
        reporterId: 'usr_task_creator',
        priority: 'URGENT',
        dueAt: '2029-12-31T09:00:00.000Z',
      })
    expect(db.prepare("SELECT role, removedAt FROM TaskParticipant WHERE taskId = 'task_v2_template' AND userId = 'usr_task_responsible'").get())
      .toEqual({ role: 'RESPONSIBLE', removedAt: null })
    expect(db.prepare("SELECT role FROM TaskParticipant WHERE id = 'tpart_task_v2_collaborator'").get())
      .toEqual({ role: 'COLLABORATOR' })
    expect(db.prepare("SELECT title, isCompleted, position, version FROM TaskChecklistItem WHERE id = 'tcheck_task_v2'").get())
      .toEqual({ title: 'Legacy checklist', isCompleted: 1, position: 1000, version: 2 })
    expect(db.prepare("SELECT triggerType, channel, status FROM TaskReminder WHERE id = 'trm_task_v2'").get())
      .toEqual({ triggerType: 'AT', channel: 'IN_APP', status: 'ACTIVE' })
    expect(db.prepare("SELECT frequency, generatedOccurrences, nextRunAt, timezone, isActive FROM TaskRecurrence WHERE templateTaskId = 'task_v2_template'").get())
      .toEqual({
        frequency: 'MONTHLY',
        generatedOccurrences: 2,
        nextRunAt: '2030-02-28T09:00:00.000Z',
        timezone: 'Europe/Kyiv',
        isActive: 1,
      })
    expect(db.prepare("SELECT recurrenceOccurrenceAt FROM Task WHERE id = 'task_v2_occurrence'").get())
      .toEqual({ recurrenceOccurrenceAt: '2030-01-31T09:00:00.000Z' })
    expect(db.prepare("SELECT code FROM Permission WHERE code = 'tasks.time.write'").get())
      .toEqual({ code: 'tasks.time.write' })
    expect(db.prepare("SELECT permissionCode, scope FROM RolePermission WHERE roleId = 'role_task_manager' AND permissionCode = 'tasks.edit.any'").get())
      .toEqual({ permissionCode: 'tasks.edit.any', scope: 'ALL_COMPANIES' })

    db.prepare("INSERT INTO Project (id, workspaceId, companyId, name, normalizedName, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .run('project_task_v2', 'ws_task_v2', 'cmp_task_v2', 'Project', 'project')
    for (const [id, parentTaskId, number] of [
      ['task_v2_child', 'task_v2_template', 'TSK-V2-3'],
      ['task_v2_grandchild', 'task_v2_child', 'TSK-V2-4'],
    ]) {
      db.prepare("INSERT INTO Task (id, workspaceId, companyId, projectId, parentTaskId, number, title, createdById, reporterId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .run(id, 'ws_task_v2', 'cmp_task_v2', null, parentTaskId, number, id, 'usr_task_creator', 'usr_task_creator')
    }
    expect(() => db.prepare("UPDATE Task SET parentTaskId = ? WHERE id = ?")
      .run('task_v2_grandchild', 'task_v2_template')).toThrow(/parent[_-]cycle/i)

    db.prepare("INSERT INTO TaskRelation (id, sourceTaskId, targetTaskId, type, createdById) VALUES (?, ?, ?, 'BLOCKS', ?)")
      .run('trel_task_v2', 'task_v2_template', 'task_v2_child', 'usr_task_creator')
    expect(() => db.prepare("INSERT INTO TaskRelation (id, sourceTaskId, targetTaskId, type, createdById) VALUES (?, ?, ?, 'BLOCKS', ?)")
      .run('trel_task_v2_cycle', 'task_v2_child', 'task_v2_template', 'usr_task_creator')).toThrow(/duplicate|cycle/i)

    db.prepare("INSERT INTO TimeEntry (id, taskId, userId, startedAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
      .run('time_task_v2_active', 'task_v2_template', 'usr_task_responsible')
    expect(() => db.prepare("INSERT INTO TimeEntry (id, taskId, userId, startedAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
      .run('time_task_v2_duplicate', 'task_v2_child', 'usr_task_responsible')).toThrow(/unique/i)

    expect(() => db.prepare("UPDATE TaskParticipant SET role = 'WATCHER', updatedAt = CURRENT_TIMESTAMP WHERE taskId = ? AND userId = ?")
      .run('task_v2_template', 'usr_task_responsible')).toThrow(/responsible[_-]required/i)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
