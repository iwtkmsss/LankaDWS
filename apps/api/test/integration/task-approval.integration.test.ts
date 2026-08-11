
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AuthPrincipal } from '../../src/common/request-context.js'
import { PrismaClient } from '../../src/generated/prisma/client.js'
import { TaskAccessService } from '../../src/modules/authorization/task-access.service.js'
import { TaskApprovalService } from '../../src/modules/tasks/task-approval.service.js'
import { TaskParticipantsService } from '../../src/modules/tasks/task-participants.service.js'

const testDb = resolve('test/tmp/task-approval/database.db')
const baseline = resolve('prisma/migrations/20260805000000_baseline/migration.sql')
const approvalMigration = resolve(
  'prisma/migrations/20260811190000_task_approval_workflow/migration.sql',
)

let prisma: PrismaClient
let approvals: TaskApprovalService
let participants: TaskParticipantsService

function principal(userId: string): AuthPrincipal {
  return {
    userId,
    workspaceId: 'wrk_1',
    username: userId,
    displayName: userId,
    primaryCompanyId: 'cmp_1',
    accountType: 'USER',
    allowedCompanyIds: ['cmp_1'],
    authorizationVersion: 1,
    sessionId: `ses_${userId}`,
    authAssurance: 1,
    restricted: false,
  }
}

beforeEach(async () => {
  rmSync(dirname(testDb), { recursive: true, force: true })
  mkdirSync(dirname(testDb), { recursive: true })
  const database = new Database(testDb)
  database.exec(readFileSync(baseline, 'utf8'))
  database.exec(readFileSync(approvalMigration, 'utf8'))
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
      "normalizedDisplayName", "username", "normalizedUsername", "approverId", "updatedAt"
    ) VALUES
      ('usr_requester', 'wrk_1', 'cmp_1', 'Requester', 'requester', 'requester', 'requester', 'usr_approver', CURRENT_TIMESTAMP),
      ('usr_approver', 'wrk_1', 'cmp_1', 'Approver', 'approver', 'approver', 'approver', NULL, CURRENT_TIMESTAMP),
      ('usr_outsider', 'wrk_1', 'cmp_1', 'Outsider', 'outsider', 'outsider', 'outsider', NULL, CURRENT_TIMESTAMP);
    INSERT INTO "Task" (
      "id", "workspaceId", "companyId", "number", "title", "createdById",
      "reporterId", "status", "version", "updatedAt"
    ) VALUES (
      'task_1', 'wrk_1', 'cmp_1', '1', 'Approval task', 'usr_requester',
      'usr_requester', 'IN_PROGRESS', 1, CURRENT_TIMESTAMP
    );
    INSERT INTO "TaskParticipant" (
      "id", "taskId", "userId", "role", "addedById", "updatedAt"
    ) VALUES
      ('part_requester', 'task_1', 'usr_requester', 'RESPONSIBLE', 'usr_requester', CURRENT_TIMESTAMP),
      ('part_approver', 'task_1', 'usr_approver', 'WATCHER', 'usr_requester', CURRENT_TIMESTAMP);
  `)
  database.close()

  const url = `file:${testDb.replaceAll('\\', '/')}`
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  await prisma.$connect()
  const access = new TaskAccessService(prisma as never)
  const feedProjection = { projectTask: () => Promise.resolve(null) } as never
  approvals = new TaskApprovalService(
    prisma as never,
    access,
    feedProjection,
  )
  participants = new TaskParticipantsService(
    prisma as never,
    access,
    feedProjection,
    approvals,
  )
})

afterEach(async () => {
  await prisma.$disconnect()
  rmSync(dirname(testDb), { recursive: true, force: true })
})

describe('task approval workflow', () => {
  it('keeps round history, preserves pending approval across non-content versions, invalidates content changes, and applies both decisions', async () => {
    const requester = principal('usr_requester')
    const approver = principal('usr_approver')

    const options = await approvals.options(requester, 'task_1')
    expect(options.items).toEqual([expect.objectContaining({
      id: 'usr_approver',
      suggested: true,
    })])

    const requested = await approvals.request(requester, 'task_1', {
      approverId: 'usr_approver',
      expectedVersion: 1,
    }, 'request-round-1')
    expect(requested).toEqual(expect.objectContaining({ status: 'PENDING', version: 2 }))
    await expect(approvals.request(requester, 'task_1', {
      approverId: 'usr_approver',
      expectedVersion: 1,
    }, 'request-round-1')).resolves.toEqual(requested)

    // Comments/personal state/time logs may advance surrounding state, but do
    // not call content invalidation. The pending round remains decidable.
    await prisma.task.update({
      where: { id: 'task_1' },
      data: { version: { increment: 1 } },
    })
    expect(await prisma.taskApprovalRound.count({
      where: { taskId: 'task_1', status: 'PENDING' },
    })).toBe(1)

    await expect(approvals.decide(principal('usr_outsider'), 'task_1', {
      decision: 'APPROVE',
      expectedVersion: 3,
      note: '',
    }, 'outsider-decision')).rejects.toMatchObject({ status: 404 })

    const needsChanges = await approvals.decide(approver, 'task_1', {
      decision: 'NEEDS_CHANGES',
      expectedVersion: 3,
      note: 'Уточніть результат.',
    }, 'decision-round-1')
    expect(needsChanges).toEqual(expect.objectContaining({
      status: 'NEEDS_CHANGES',
      version: 4,
      watcherExitAvailable: false,
    }))
    expect(await prisma.task.findUnique({
      where: { id: 'task_1' },
      select: { status: true },
    })).toEqual({ status: 'IN_PROGRESS' })

    await approvals.request(requester, 'task_1', {
      approverId: 'usr_approver',
      expectedVersion: 4,
    }, 'request-round-2')
    await prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id: 'task_1' },
        data: { title: 'Materially changed', version: { increment: 1 } },
      })
      await approvals.invalidatePending(
        tx,
        requester,
        task,
        task.version,
        'TASK_UPDATED',
      )
    })
    expect(await prisma.task.findUnique({
      where: { id: 'task_1' },
      select: { status: true, version: true },
    })).toEqual({ status: 'IN_PROGRESS', version: 6 })

    await approvals.request(requester, 'task_1', {
      approverId: 'usr_approver',
      expectedVersion: 6,
    }, 'request-round-3')
    const approved = await approvals.decide(approver, 'task_1', {
      decision: 'APPROVE',
      expectedVersion: 7,
      note: '',
    }, 'decision-round-3')
    expect(approved).toEqual(expect.objectContaining({
      status: 'APPROVED',
      version: 8,
      watcherExitAvailable: true,
    }))
    await expect(approvals.decide(approver, 'task_1', {
      decision: 'APPROVE',
      expectedVersion: 7,
      note: '',
    }, 'decision-round-3')).resolves.toEqual(approved)
    const completed = await prisma.task.findUnique({
      where: { id: 'task_1' },
      select: { status: true, completedAt: true },
    })
    expect(completed?.status).toBe('DONE')
    expect(completed?.completedAt).toBeInstanceOf(Date)
    expect(await prisma.taskApprovalRound.findMany({
      where: { taskId: 'task_1' },
      orderBy: { roundNumber: 'asc' },
      select: { roundNumber: true, status: true },
    })).toEqual([
      { roundNumber: 1, status: 'NEEDS_CHANGES' },
      { roundNumber: 2, status: 'INVALIDATED' },
      { roundNumber: 3, status: 'APPROVED' },
    ])
    expect(await prisma.auditEvent.count({
      where: { entityType: 'TASK', entityId: 'task_1', action: { startsWith: 'task.approval_' } },
    })).toBe(6)
    expect(await prisma.outboxEvent.count({
      where: { aggregateType: 'TASK', aggregateId: 'task_1', eventType: { startsWith: 'task.approval_' } },
    })).toBe(6)

    await expect(participants.remove(approver, 'task_1', 'usr_requester', 8))
      .rejects.toMatchObject({ status: 404 })
    await expect(participants.remove(approver, 'task_1', 'usr_approver', 7))
      .rejects.toMatchObject({ status: 409 })
    expect(await prisma.taskParticipant.findUnique({
      where: { taskId_userId: { taskId: 'task_1', userId: 'usr_approver' } },
      select: { removedAt: true },
    })).toEqual({ removedAt: null })

    await expect(participants.remove(approver, 'task_1', 'usr_approver', 8))
      .resolves.toEqual({ version: 9, accessRetained: false })
    await expect(new TaskAccessService(prisma as never).readableTask(approver, 'task_1'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('enforces one pending round at the persistence boundary', () => {
    const database = new Database(testDb)
    database.prepare(`
      INSERT INTO "TaskApprovalRound" (
        "id", "taskId", "roundNumber", "approverId", "requestedById", "requestedTaskVersion"
      ) VALUES (?, 'task_1', ?, 'usr_approver', 'usr_requester', 1)
    `).run('approval_1', 1)
    expect(() => database.prepare(`
      INSERT INTO "TaskApprovalRound" (
        "id", "taskId", "roundNumber", "approverId", "requestedById", "requestedTaskVersion"
      ) VALUES (?, 'task_1', ?, 'usr_approver', 'usr_requester', 1)
    `).run('approval_2', 2)).toThrow(/UNIQUE constraint failed/)
    database.close()
  })
})
