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
      groupId: null,
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

describe('TaskParticipantsService.mentionCandidates group boundary', () => {
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

  it('does not constrain candidates by group for an ungrouped task', async () => {
    const { service, userFindMany } = makeService({ readableTask: { groupId: null } })

    await service.mentionCandidates(principal(), 'tsk_1', { q: 'ол', limit: 8 })

    const where = userFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(where.where).not.toHaveProperty('groupMemberships')
    expect(where.where).toMatchObject({ workspaceId: 'ws_lankadws', isActive: true })
  })

  it('restricts candidates to active members of the group for a grouped task', async () => {
    const { service, userFindMany } = makeService({ readableTask: { groupId: 'grp_x' } })

    await service.mentionCandidates(principal(), 'tsk_1', { q: 'ол', limit: 8 })

    const where = userFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(where.where).toMatchObject({
      workspaceId: 'ws_lankadws',
      isActive: true,
      groupMemberships: { some: { groupId: 'grp_x', leftAt: null } },
    })
  })
})

describe('TaskParticipantsService.ensureMentionWatchers group boundary', () => {
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

  it('rejects a mention of a non-member on a grouped task', async () => {
    const { service } = makeService({})
    await expect(service.ensureMentionWatchers(
      tx([]),
      principal(),
      { id: 'tsk_1', companyId: 'cmp_a', groupId: 'grp_x' },
      ['usr_olena'],
    )).rejects.toMatchObject({ status: 400, code: 'task_mention_outside_scope' })
  })

  it('accepts a mention of an active workspace user on an ungrouped task', async () => {
    const { service } = makeService({})
    const added = await service.ensureMentionWatchers(
      tx([{ id: 'usr_olena' }]),
      principal(),
      { id: 'tsk_1', companyId: 'cmp_a', groupId: null },
      ['usr_olena'],
    )
    expect(added).toEqual(['usr_olena'])
  })
})
