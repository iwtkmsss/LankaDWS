import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { TaskAccessService } from '../authorization/task-access.service.js'
import type { FeedProjectionService } from '../feed/feed-projection.service.js'
import type { Task } from '../../generated/prisma/client.js'
import { TaskParticipantsService } from './task-participants.service.js'
import type { TaskTransaction } from './task-types.js'

function principal(): AuthPrincipal {
  return {
    userId: 'usr_maria',
    workspaceId: 'ws_lankadws',
    username: 'maria',
    displayName: 'Maria',
    primaryCompanyId: 'cmp_a',
    accountType: 'USER',
    allowedCompanyIds: ['cmp_a', 'cmp_b'],
    authorizationVersion: 1,
    sessionId: 'sess_1',
    authAssurance: 1,
    restricted: false,
  }
}

function makeService(overrides: {
  readableTask?: Partial<Task>
  userFindMany?: ReturnType<typeof vi.fn>
}) {
  const userFindMany = overrides.userFindMany ?? vi.fn().mockResolvedValue([])
  const prisma = {
    user: { findMany: userFindMany, findFirst: vi.fn().mockResolvedValue(null) },
  }
  const access = {
    readableTask: vi.fn().mockResolvedValue({
      id: 'tsk_1',
      companyId: 'cmp_a',
      ...overrides.readableTask,
    }),
  }
  const service = new TaskParticipantsService(
    prisma as unknown as PrismaService,
    access as unknown as TaskAccessService,
    {} as unknown as FeedProjectionService,
  )
  return { service, userFindMany }
}

describe('TaskParticipantsService.mentionCandidates workspace boundary', () => {
  it('rejects an aggregate with more than one responsible', async () => {
    const { service } = makeService({})

    await expect(service.createMany(
      {} as TaskTransaction,
      'tsk_1',
      'usr_maria',
      [
        { userId: 'usr_maria', role: 'RESPONSIBLE' },
        { userId: 'usr_andrii', role: 'RESPONSIBLE' },
      ],
    )).rejects.toMatchObject({ status: 400, code: 'task_responsible_required' })
  })

  it('admits active workspace users across companies', async () => {
    const { service, userFindMany } = makeService({})

    await service.mentionCandidates(principal(), 'tsk_1', { q: 'ол', limit: 8 })

    const where = userFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(where.where).not.toHaveProperty('primaryCompanyId')
    expect(where.where).toMatchObject({ workspaceId: 'ws_lankadws', isActive: true })
  })


})

describe('TaskParticipantsService.ensureMentionWatchers workspace boundary', () => {
  function tx(eligible: Array<{ id: string }>): TaskTransaction {
    return {
      user: { findMany: vi.fn().mockResolvedValue(eligible) },
      taskParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as TaskTransaction
  }

  it('rejects a mention of an inactive or outside-workspace user', async () => {
    const { service } = makeService({})
    await expect(service.ensureMentionWatchers(
      tx([]),
      principal(),
      { id: 'tsk_1', companyId: 'cmp_a' },
      ['usr_olena'],
    )).rejects.toMatchObject({ status: 400, code: 'task_mention_outside_scope' })
  })

  it('accepts a mention of an active workspace user', async () => {
    const { service } = makeService({})
    const added = await service.ensureMentionWatchers(
      tx([{ id: 'usr_olena' }]),
      principal(),
      { id: 'tsk_1', companyId: 'cmp_a' },
      ['usr_olena'],
    )
    expect(added).toEqual(['usr_olena'])
  })
})

describe('task delegation', () => {
  function setup(role: string | null = 'RESPONSIBLE', status = 'IN_PROGRESS', reporterId = 'poster') {
    const task = { id: 'tsk_1', reporterId, companyId: 'cmp_a', status }
    const tx = {
      task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(task) },
      taskParticipant: { findFirst: vi.fn().mockResolvedValue({ userId: 'usr_maria' }), findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), upsert: vi.fn().mockResolvedValue({ id: 'participant' }), findMany: vi.fn().mockResolvedValue([{ userId: 'new' }]) },
      auditEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
    }
    const prisma = { user: { findFirst: vi.fn().mockResolvedValue({ id: 'new' }) }, taskParticipant: { findFirst: vi.fn().mockResolvedValue(role ? { role } : null) }, $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)) }
    const service = new TaskParticipantsService(prisma as never, { readableTask: vi.fn().mockResolvedValue(task) } as never, { projectTask: vi.fn().mockResolvedValue(null) } as never)
    return { service, tx, prisma }
  }
  it('allows the responsible to delegate while retaining the former responsible as watcher', async () => {
    const { service, tx } = setup()
    await expect(service.put(principal(), 'tsk_1', 'new', 'RESPONSIBLE', 3, true)).resolves.toEqual({ version: 4 })
    expect(tx.taskParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'WATCHER' } }))
    const event = tx.outboxEvent.create.mock.calls[0]?.[0] as unknown as { data: { safePayload: string } }
    expect(event.data.safePayload).toContain('"previousResponsibleId":"usr_maria"')
  })
  it('allows the poster to delegate someone else and retains the replaced responsible', async () => {
    const { service, tx } = setup(null, 'IN_PROGRESS', 'usr_maria')
    tx.taskParticipant.findFirst.mockResolvedValue({ userId: 'former' })
    await expect(service.put(principal(), 'tsk_1', 'new', 'RESPONSIBLE', 3, true)).resolves.toEqual({ version: 4 })
    expect(tx.taskParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'WATCHER' } }))
  })
  it.each(['NEW', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'ARCHIVED'])('allows both roles to delegate in %s without changing status', async (status) => {
    for (const poster of [false, true]) {
      const { service, tx } = setup(poster ? null : 'RESPONSIBLE', status, poster ? 'usr_maria' : 'poster')
      await expect(service.put(principal(), 'tsk_1', 'new', 'RESPONSIBLE', 3, true)).resolves.toEqual({ version: 4 })
      expect(tx.task.updateMany).toHaveBeenCalledWith({ where: { id: 'tsk_1', version: 3 }, data: { version: { increment: 1 } } })
      expect(tx.taskParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'WATCHER' } }))
      expect(tx.taskParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { role: 'RESPONSIBLE', addedById: 'usr_maria', removedAt: null } }))
    }
  })
  it('rejects watchers, self delegation, and stale versions', async () => {
    await expect(setup(null).service.put(principal(), 'tsk_1', 'new', 'RESPONSIBLE', 3, true)).rejects.toMatchObject({ status: 403 })
    await expect(setup().service.put(principal(), 'tsk_1', 'usr_maria', 'RESPONSIBLE', 3, true)).rejects.toMatchObject({ status: 400 })
    const { service, tx } = setup()
    tx.task.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.put(principal(), 'tsk_1', 'new', 'RESPONSIBLE', 3, true)).rejects.toMatchObject({ status: 409 })
    expect(tx.taskParticipant.upsert).not.toHaveBeenCalled()
  })
})
