import { describe, expect, it, vi } from 'vitest'
import type { CreateTaskInput } from '@bert-crm/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DomainError } from '../../common/errors.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskResponseMapper } from './task-response.mapper.js'

function principal(accountType: 'ADMIN' | 'USER' = 'USER'): AuthPrincipal {
  return {
    userId: 'usr_actor',
    workspaceId: 'wrk_1',
    username: 'actor',
    displayName: 'Actor',
    accountType,
    primaryCompanyId: 'cmp_1',
    allowedCompanyIds: ['cmp_1'],
    authorizationVersion: 1,
    sessionId: 'ses_1',
    authAssurance: 1,
    restricted: false,
  }
}

function createInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title: 'Prepare launch',
    description: 'Coordinate the release',
    groupId: null,
    projectId: 'prj_1',
    parentTaskId: null,
    reporterId: 'usr_actor',
    priority: 'HIGH',
    startsAt: '2026-08-01T09:00:00.000+03:00',
    dueAt: '2026-08-02T18:00:00.000+03:00',
    estimatedMinutes: 120,
    participants: [
      { userId: 'usr_owner', role: 'RESPONSIBLE' },
      { userId: 'usr_actor', role: 'COLLABORATOR' },
    ],
    checklistItems: [
      { clientId: 'client_1', title: 'Review copy', isCompleted: false },
    ],
    tagIds: ['tag_1'],
    relations: [],
    reminders: [],
    recurrence: null,
    attachmentIds: [],
    ...overrides,
  }
}

describe('TaskCommandService', () => {
  it('creates the complete aggregate, idempotency result, audit and outbox atomically', async () => {
    const tx = {
      task: {
        create: vi.fn().mockResolvedValue({ version: 1 }),
      },
      taskTag: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      idempotencyRecord: {
        create: vi.fn().mockResolvedValue({}),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    const prisma = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    }
    const validation = {
      validateCreate: vi.fn().mockResolvedValue({
        companyId: 'cmp_1',
        groupId: null,
        projectId: 'prj_1',
        parentTaskId: null,
        reporterId: 'usr_actor',
        startsAt: new Date('2026-08-01T06:00:00.000Z'),
        dueAt: new Date('2026-08-02T15:00:00.000Z'),
        participants: createInput().participants,
        tagIds: ['tag_1'],
        relations: [],
      }),
    }
    const participants = {
      createMany: vi.fn().mockResolvedValue(undefined),
    }
    const checklist = {
      createMany: vi.fn().mockResolvedValue({ client_1: 'tcheck_1' }),
    }
    const relations = {
      createMany: vi.fn().mockResolvedValue(undefined),
    }
    const reminders = {
      createMany: vi.fn().mockResolvedValue([]),
    }
    const recurrence = {
      timezoneFor: vi.fn().mockResolvedValue('Europe/Kyiv'),
      create: vi.fn().mockResolvedValue('trec_1'),
    }
    const attachments = {
      validateStaged: vi.fn().mockResolvedValue(['file_1']),
      linkMany: vi.fn().mockResolvedValue(undefined),
    }
    const feedProjection = {
      projectTask: vi.fn().mockResolvedValue('fitem_1'),
    }
    const service = new TaskCommandService(
      prisma as never,
      {
        runInTransaction: vi.fn((
          client: typeof prisma,
          callback: (transaction: typeof tx, number: string) => unknown,
        ) => (
          client.$transaction((transaction: typeof tx) => callback(transaction, '2405'))
        )),
      } as never,
      {} as never,
      validation as never,
      {} as never,
      participants as never,
      checklist as never,
      relations as never,
      reminders as never,
      recurrence as never,
      attachments as never,
      feedProjection as never,
      {} as never,
    )

    const input = createInput({
      reminders: [{
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_DUE', offsetMinutes: 60 },
      }],
      recurrence: {
        frequency: 'DAILY',
        interval: 1,
        startsAt: '2026-08-03T09:00:00.000+03:00',
        maxOccurrences: 2,
      },
      attachmentIds: ['file_1'],
    })
    const result = await service.create(
      principal(),
      input,
      'request-1',
    )

    expect(result.id).toMatch(/^tsk_/)
    expect(result.number).toMatch(/^\d+$/)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(participants.createMany).toHaveBeenCalledOnce()
    expect(checklist.createMany).toHaveBeenCalledOnce()
    expect(tx.taskTag.createMany).toHaveBeenCalledWith({
      data: [{ taskId: result.id, tagId: 'tag_1' }],
    })
    expect(tx.idempotencyRecord.create).toHaveBeenCalledOnce()
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce()
    expect(reminders.createMany).toHaveBeenCalledOnce()
    expect(recurrence.create).toHaveBeenCalledOnce()
    expect(attachments.linkMany).toHaveBeenCalledWith(tx, result.id, ['file_1'])
  })

})

describe('TaskAccessService', () => {
  it('lets a collaborator edit while a watcher remains read-only', async () => {
    const task = {
      id: 'tsk_1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
      groupId: null,
      createdById: 'usr_creator',
      reporterId: 'usr_reporter',
    }
    const prisma = {
      task: {
        findFirst: vi.fn().mockResolvedValue(task),
      },
      taskParticipant: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: 'part_1' })
          .mockResolvedValueOnce({ id: 'part_1' }),
      },
    }
    const service = new TaskAccessService(prisma as never)

    await expect(service.editableTask(principal(), 'tsk_1')).resolves.toBe(task)

    prisma.taskParticipant.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'part_2' })
      .mockResolvedValueOnce(null)
    await expect(service.editableTask(principal(), 'tsk_1'))
      .rejects.toBeInstanceOf(DomainError)
  })

  it('lets a global administrator edit any task in scope', async () => {
    const task = {
      id: 'tsk_1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
      groupId: null,
      createdById: 'usr_creator',
      reporterId: 'usr_reporter',
    }
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(task) },
      taskParticipant: { findFirst: vi.fn() },
    }
    const service = new TaskAccessService(prisma as never)

    await expect(service.editableTask(
      principal('ADMIN'),
      'tsk_1',
    )).resolves.toBe(task)
  })
})

describe('TaskResponseMapper', () => {
  it('normalizes dates, relations, time totals and capability flags', () => {
    const date = new Date('2026-08-01T06:00:00.000Z')
    const task = {
      id: 'tsk_1',
      number: '1',
      title: 'Task',
      description: '',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      version: 3,
      groupId: null,
      projectId: null,
      parentTaskId: null,
      startsAt: date,
      dueAt: null,
      estimatedMinutes: 60,
      completedAt: null,
      archivedAt: null,
      createdAt: date,
      updatedAt: date,
      createdById: 'usr_actor',
      reporterId: 'usr_actor',
      createdBy: { id: 'usr_actor', displayName: 'Actor', avatarAsset: null },
      reporter: { id: 'usr_actor', displayName: 'Actor', avatarAsset: null },
      group: null,
      project: null,
      parent: null,
      subtasks: [],
      participants: [],
      checklist: [],
      tags: [],
      outgoingRelations: [{
        id: 'rel_1',
        type: 'BLOCKS',
        createdAt: date,
        targetTask: { id: 'tsk_2', number: '2', title: 'Target', status: 'NEW' },
      }],
      incomingRelations: [],
      reminders: [],
      recurrenceTemplate: null,
      timeEntries: [
        {
          id: 'time_1',
          userId: 'usr_actor',
          startedAt: date,
          endedAt: date,
          durationSeconds: 900,
        },
        {
          id: 'time_2',
          userId: 'usr_actor',
          startedAt: date,
          endedAt: null,
          durationSeconds: null,
        },
      ],
    }

    const result = new TaskResponseMapper().detail(
      principal(),
      task as never,
    )

    expect(result.startsAt).toBe('2026-08-01T06:00:00.000Z')
    expect(result.relations[0]).toMatchObject({
      id: 'rel_1',
      direction: 'OUTGOING',
    })
    expect(result.time?.totalSeconds).toBe(900)
    expect(result.time?.activeTimer?.id).toBe('time_2')
    expect(result.permissions).toMatchObject({
      canEdit: true,
      canReadTime: true,
      canWriteTime: true,
    })
  })
})
