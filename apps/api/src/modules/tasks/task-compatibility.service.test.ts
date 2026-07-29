import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskCompatibilityService } from './task-compatibility.service.js'

function principal(): AuthPrincipal {
  return {
    userId: 'usr_viewer',
    workspaceId: 'wrk_1',
    username: 'viewer',
    displayName: 'Viewer',
    displayRole: 'User',
    primaryCompanyId: 'cmp_1',
    allowedCompanyIds: ['cmp_1'],
    permissions: new Set(['tasks.read']),
    authorizationVersion: 1,
    sessionId: 'ses_1',
    authAssurance: 1,
    restricted: false,
  }
}

function serviceWith(prisma: Record<string, unknown>, access: Record<string, unknown> = {}) {
  return new TaskCompatibilityService(
    prisma as never,
    { allowedCompanies: vi.fn().mockReturnValue(['cmp_1']) } as never,
    access as never,
    {} as never,
    {} as never,
    {} as never,
  )
}

describe('TaskCompatibilityService', () => {
  it('maps the legacy collaborator list onto v2 participants, dueAt and URGENT', async () => {
    const task = {
      id: 'task_1',
      number: 'TSK-1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
      parentTaskId: null,
      title: 'Launch',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      dueAt: new Date('2026-08-01T12:00:00.000Z'),
      version: 3,
      createdById: 'usr_creator',
      reporterId: 'usr_reporter',
      reporter: {
        id: 'usr_reporter',
        displayName: 'Reporter',
        avatarAsset: null,
      },
      parent: null,
      subtasks: [
        { id: 'sub_1', number: 'TSK-2', title: 'Done', status: 'DONE' },
        { id: 'sub_2', number: 'TSK-3', title: 'Open', status: 'NEW' },
      ],
      participants: [
        {
          id: 'part_responsible',
          userId: 'usr_owner',
          role: 'RESPONSIBLE',
          createdAt: new Date('2026-07-01T10:00:00.000Z'),
          user: {
            id: 'usr_owner',
            displayName: 'Owner',
            avatarAsset: null,
          },
        },
        {
          id: 'part_viewer',
          userId: 'usr_viewer',
          role: 'COLLABORATOR',
          createdAt: new Date('2026-07-01T11:00:00.000Z'),
          user: {
            id: 'usr_viewer',
            displayName: 'Viewer',
            avatarAsset: null,
          },
        },
      ],
    }
    const prisma = {
      task: {
        findMany: vi.fn().mockResolvedValue([task]),
        count: vi.fn().mockResolvedValue(1),
      },
      comment: { count: vi.fn().mockResolvedValue(2) },
      fileLink: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    }
    const service = serviceWith(prisma)

    const result = await service.list(principal(), undefined, 'CO_EXECUTOR')

    const listCall = prisma.task.findMany.mock.calls[0]?.[0] as {
      where: { AND: unknown[] }
    }
    expect(listCall.where.AND).toContainEqual({
      participants: {
        some: {
          userId: 'usr_viewer',
          role: 'COLLABORATOR',
          removedAt: null,
        },
      },
    })
    expect(result.items[0]).toEqual(expect.objectContaining({
      assignee: task.participants[0].user,
      priority: 'CRITICAL',
      deadline: '2026-08-01T12:00:00.000Z',
      viewerRoles: ['CO_EXECUTOR'],
      commentCount: 2,
      attachmentCount: 1,
      subtaskProgress: { done: 1, total: 2 },
    }))
  })

  it('adds a legacy-selected responsible without removing existing responsibles', async () => {
    const task = {
      id: 'task_1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
      groupId: null,
      createdById: 'usr_viewer',
      reporterId: 'usr_viewer',
      title: 'Before',
      description: '',
      status: 'NEW',
      priority: 'MEDIUM',
      version: 2,
    }
    const tx = {
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskParticipant: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'usr_owner' }, { id: 'usr_viewer' }]),
      },
      taskParticipant: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    }
    const service = serviceWith(prisma, {
      editableTask: vi.fn().mockResolvedValue(task),
    })

    await service.updateLegacy(principal(), task.id, {
      title: 'After',
      description: '',
      assigneeId: 'usr_owner',
      creatorId: 'usr_viewer',
      deadline: null,
      priority: 'HIGH',
      expectedVersion: 2,
    })

    const upsertCall = tx.taskParticipant.upsert.mock.calls[0]?.[0] as {
      where: { taskId_userId: { taskId: string; userId: string } }
      create: { taskId: string; userId: string; role: string }
      update: { role: string; removedAt: null; addedById: string }
    }
    expect(upsertCall.where).toEqual({
      taskId_userId: {
        taskId: task.id,
        userId: 'usr_owner',
      },
    })
    expect(upsertCall.create).toEqual({
      ...upsertCall.create,
      taskId: task.id,
      userId: 'usr_owner',
      role: 'RESPONSIBLE',
    })
    expect(upsertCall.update).toEqual({
      role: 'RESPONSIBLE',
      removedAt: null,
      addedById: 'usr_viewer',
    })
    expect(tx.taskParticipant.upsert).toHaveBeenCalledWith({
      where: {
        taskId_userId: {
          taskId: task.id,
          userId: 'usr_owner',
        },
      },
      create: upsertCall.create,
      update: {
        role: 'RESPONSIBLE',
        removedAt: null,
        addedById: 'usr_viewer',
      },
    })
    expect(tx.taskParticipant).not.toHaveProperty('updateMany')
  })
})
