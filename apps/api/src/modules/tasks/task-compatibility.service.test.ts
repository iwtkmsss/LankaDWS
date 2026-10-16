import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskCompatibilityService } from './task-compatibility.service.js'

function principal(): AuthPrincipal {
  return {
    userId: 'usr_viewer',
    workspaceId: 'wrk_1',
    username: 'viewer',
    displayName: 'Viewer',
    accountType: 'USER',
    primaryCompanyId: 'cmp_1',
    allowedCompanyIds: ['cmp_1'],
    authorizationVersion: 1,
    sessionId: 'ses_1',
    authAssurance: 1,
    restricted: false,
  }
}

function serviceWith(prisma: Record<string, unknown>, access: Record<string, unknown> = {}, files: Record<string, unknown> = {}) {
  return new TaskCompatibilityService(
    prisma as never,
    { allowedCompanies: vi.fn().mockReturnValue(['cmp_1']) } as never,
    access as never,
    files as never,
    {} as never,
    {} as never,
    {} as never,
  )
}

describe('TaskCompatibilityService', () => {
  it('stages a composer upload without linking it, changing the task or publishing an event', async () => {
    const staged = { id: 'file_1', fileName: 'note.txt', bytes: 4, mimeType: 'text/plain', scanStatus: 'QUARANTINED' }
    const transaction = vi.fn()
    const stageTaskUpload = vi.fn().mockResolvedValue(staged)
    const service = serviceWith({ fileLink: { count: vi.fn().mockResolvedValue(0) }, $transaction: transaction }, {
      readableTask: vi.fn().mockResolvedValue({ id: 'task_1', companyId: 'cmp_2' }),
    }, { stageTaskUpload })
    const file = { buffer: Buffer.from('note'), size: 4, mimetype: 'text/plain', originalname: 'note.txt' }
    await expect(service.uploadAttachment(principal(), 'task_1', file, true)).resolves.toMatchObject(staged)
    expect(stageTaskUpload).toHaveBeenCalledWith(principal(), file, 'cmp_2')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('keeps a Drive attachment private until the comment is sent', async () => {
    const transaction = vi.fn()
    const assertTaskStagedAttachments = vi.fn().mockResolvedValue([])
    const service = serviceWith({
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'file_1', companyId: 'cmp_1', safeFilename: 'note.txt', bytes: 4,
        detectedMime: 'text/plain', scanStatus: 'CLEAN', createdAt: new Date() }) },
      fileLink: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: transaction,
    }, { readableTask: vi.fn().mockResolvedValue({ id: 'task_1', companyId: 'cmp_1' }) }, { assertTaskStagedAttachments })
    await expect(service.attachDriveFile(principal(), 'task_1', 'file_1', true)).resolves.toMatchObject({ id: 'file_1' })
    expect(assertTaskStagedAttachments).toHaveBeenCalledWith(principal(), 'cmp_1', ['file_1'])
    expect(transaction).not.toHaveBeenCalled()
  })

  it.each(['full', 'linked-concurrently'])('rejects publishing staged files when the task is %s', async (reason) => {
    const create = vi.fn()
    const tx = { fileLink: { count: vi.fn().mockResolvedValue(reason === 'full' ? 20 : 0),
      findFirst: vi.fn().mockResolvedValue(reason === 'linked-concurrently' ? { id: 'existing_link' } : null) }, comment: { create } }
    const service = serviceWith({ fileLink: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }, { readableTask: vi.fn().mockResolvedValue({ id: 'task_1', companyId: 'cmp_1' }) }, {
      assertTaskStagedAttachments: vi.fn().mockResolvedValue([]),
    })
    await expect(service.addComment(principal(), 'task_1', { body: '', mentions: [], attachmentIds: ['file_1'] }))
      .rejects.toMatchObject({ code: reason === 'full' ? 'task_attachment_limit' : 'task_comment_attachments' })
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['linked', 'staged'])('creates an attachment-only comment with %s files atomically', async (source) => {
    const task = { id: 'task_1', companyId: 'cmp_1', reporterId: 'usr_viewer', title: 'Task' }
    const tx = {
      comment: { create: vi.fn().mockImplementation(({ data }: {
        data: { id: string; body: string; entityId: string; authorId: string }
      }) => Promise.resolve(data)) },
      fileLink: { createMany: vi.fn(), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
      task: { update: vi.fn().mockResolvedValue({ version: 2 }), findUniqueOrThrow: vi.fn().mockResolvedValue(task) },
      taskParticipant: { findMany: vi.fn().mockResolvedValue([]) },
      taskFollower: { findMany: vi.fn().mockResolvedValue([]) },
      auditEvent: { create: vi.fn() },
      outboxEvent: { create: vi.fn() },
    }
    const service = new TaskCompatibilityService(
      { fileLink: { findMany: vi.fn().mockResolvedValue(source === 'linked' ? [{ fileId: 'file_1' }] : []) },
        $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as never,
      {} as never,
      { readableTask: vi.fn().mockResolvedValue(task) } as never,
      { assertTaskStagedAttachments: vi.fn().mockResolvedValue([]), retainStagedAttachments: vi.fn(), markAttachmentsRetained: vi.fn() } as never,
      {} as never,
      { projectTask: vi.fn().mockResolvedValue('feed_1') } as never,
      { ensureMentionWatchers: vi.fn().mockResolvedValue([]) } as never,
    )
    const comment = await service.addComment(principal(), 'task_1', {
      body: '', attachmentIds: ['file_1'], mentions: [],
    })
    expect(comment).toMatchObject({ body: '', entityId: 'task_1', authorId: 'usr_viewer' })
    expect(tx.fileLink.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      fileId: 'file_1', entityType: 'TASK_COMMENT', entityId: comment.id,
    })] })
    if (source === 'staged') {
      expect(tx.fileLink.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
        fileId: 'file_1', entityType: 'TASK', entityId: 'task_1',
      })] })
    }
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce()
    expect(tx.auditEvent.create.mock.calls[0]).toMatchObject([{ data: { action: 'task.comment_created' } }])
  })

  it('rejects empty comments and attachments not linked to the readable task', async () => {
    const transaction = vi.fn()
    const service = serviceWith({
      fileLink: { findMany: vi.fn().mockResolvedValue([]) }, $transaction: transaction,
    }, { readableTask: vi.fn().mockResolvedValue({ id: 'task_1', companyId: 'cmp_1' }) }, {
      assertTaskStagedAttachments: vi.fn().mockRejectedValue({ code: 'task_comment_attachments' }),
    })
    for (const body of ['', '   ']) {
      await expect(service.addComment(principal(), 'task_1', {
        body, attachmentIds: [], mentions: [],
      })).rejects.toMatchObject({ code: 'comment_body' })
    }
    await expect(service.addComment(principal(), 'task_1', {
      body: '', attachmentIds: ['file_other_task'], mentions: [],
    })).rejects.toMatchObject({ code: 'task_comment_attachments' })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('unions explicit statuses and rejects unknown statuses without weakening access scope', () => {
    const service = serviceWith({})
    const where = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { status: 'NEW,IN_PROGRESS' })
    expect(where).toMatchObject({ workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, status: { in: ['NEW', 'IN_PROGRESS'] } })
    expect(where.AND).toContainEqual({ participants: { some: { userId: 'usr_viewer', role: 'RESPONSIBLE', removedAt: null } } })
    const mixed = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { preset: 'OVERDUE,IN_REVIEW,DONE' })
    expect(mixed.AND).toContainEqual({ OR: [
      { dueAt: { lt: expect.any(Date) as Date }, status: { notIn: ['DONE', 'ARCHIVED'] } },
      { status: 'IN_REVIEW' }, { status: 'DONE' },
    ] })
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE', { status: 'NEW,UNKNOWN' })).toThrow()
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE', { status: 'NEW,' })).toThrow()
  })
  it('unions selected task presets while retaining role and scope restrictions', () => {
    const service = serviceWith({})
    const where = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { preset: 'DEFERRED,OVERDUE,DUE_SOON' })
    expect(where).toMatchObject({ workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, archivedAt: null })
    expect(where.AND).toContainEqual({ participants: { some: { userId: 'usr_viewer', role: 'RESPONSIBLE', removedAt: null } } })
    expect(where.AND).toContainEqual({ OR: [
      { status: 'NEW' },
      { dueAt: { lt: expect.any(Date) as Date }, status: { notIn: ['DONE', 'ARCHIVED'] } },
      { dueAt: { gte: expect.any(Date) as Date, lte: expect.any(Date) as Date }, status: { notIn: ['DONE', 'ARCHIVED'] } },
    ] })
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE', { preset: 'ACTIVE,UNKNOWN' })).toThrow()
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE', { preset: 'ACTIVE' })).toThrow()
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE', { preset: 'NONE,OVERDUE' })).toThrow()
  })
  it('includes active tasks without a near deadline and unions active and terminal selections safely', () => {
    const service = serviceWith({})
    const otherActive = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { preset: 'OTHER_ACTIVE' })
    expect(otherActive).toMatchObject({ workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, archivedAt: null })
    expect(otherActive.AND).toContainEqual({
      status: { in: ['IN_PROGRESS', 'IN_REVIEW'] },
      OR: [{ dueAt: null }, { dueAt: { gt: expect.any(Date) as Date } }],
    })
    const mixed = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { preset: 'OTHER_ACTIVE,DONE,ARCHIVED' })
    expect(mixed.AND).toContainEqual({ participants: { some: { userId: 'usr_viewer', role: 'RESPONSIBLE', removedAt: null } } })
    expect(mixed.AND).toContainEqual({ OR: [
      { status: { in: ['IN_PROGRESS', 'IN_REVIEW'] }, OR: [{ dueAt: null }, { dueAt: { gt: expect.any(Date) as Date } }] },
      { status: 'DONE' }, { status: 'ARCHIVED' },
    ] })
    expect(mixed).toMatchObject({ workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, archivedAt: null })
    const empty = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE', { preset: 'NONE' })
    expect(empty.AND).toContainEqual({ id: { in: [] } })
    expect(empty.AND).toContainEqual({ participants: { some: { userId: 'usr_viewer', role: 'RESPONSIBLE', removedAt: null } } })
  })
  it('combines selected roles with OR while retaining scope and validating every role', () => {
    const service = serviceWith({})
    const where = service.listWhere(principal(), 'cmp_1', 'RESPONSIBLE,CREATOR', { status: 'DONE' })
    expect(where).toMatchObject({ workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, archivedAt: null, status: 'DONE' })
    expect(where.AND).toContainEqual({ OR: [
      { participants: { some: { userId: 'usr_viewer', role: 'RESPONSIBLE', removedAt: null } } },
      { reporterId: 'usr_viewer' },
    ] })
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE,UNKNOWN')).toThrow()
    expect(() => service.listWhere(principal(), undefined, 'RESPONSIBLE,ALL')).toThrow()
    expect(() => service.listWhere(principal(), undefined, '')).toThrow()
    const adminWhere = service.listWhere({ ...principal(), accountType: 'ADMIN' }, undefined, 'RESPONSIBLE,ALL')
    expect(adminWhere.AND).toEqual([{}])
  })
  it('shares status, personal and access filters with notification counts', () => {
    const service = serviceWith({})
    const active = service.listWhere(principal(), 'cmp_1', undefined, { preset: 'DEFERRED', favorite: 'true', search: 'Launch' })
    expect(active).toMatchObject({
      workspaceId: 'wrk_1', companyId: { in: ['cmp_1'] }, archivedAt: null,
      userStates: { some: { userId: 'usr_viewer', favoritedAt: { not: null } } },
    })
    expect(active.AND).toContainEqual({ status: 'NEW' })
    expect(active.AND).toContainEqual({ OR: [
      { createdById: 'usr_viewer' }, { reporterId: 'usr_viewer' },
      { participants: { some: { userId: 'usr_viewer', removedAt: null } } },
    ] })
    const completed = service.listWhere(principal(), 'cmp_1', 'CO_EXECUTOR', { status: 'DONE' })
    expect(completed.status).toBe('DONE')
    expect(completed.AND).toEqual([{ participants: { some: { userId: 'usr_viewer', role: 'COLLABORATOR', removedAt: null } } }])
    expect(() => service.listWhere(principal(), 'cmp_1', 'ALL')).toThrow()
  })
  it('keeps comment editing and deletion admin-only', async () => {
    const access = {
      readableTask: vi.fn().mockResolvedValue({
        id: 'task_1',
        companyId: 'cmp_1',
      }),
    }
    const service = serviceWith({}, access)

    await expect(service.updateComment(principal(), 'task_1', 'comment_1', {
      body: 'Оновлений текст',
      mentions: [],
      expectedVersion: 1,
    })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(service.deleteComment(principal(), 'task_1', 'comment_1', {
      expectedVersion: 1,
    })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('maps the legacy collaborator list onto v2 participants, dueAt and URGENT', async () => {
    const task = {
      id: 'task_1',
      number: '1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
      parentTaskId: null,
      title: 'Launch',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      dueAt: new Date('2026-08-01T12:00:00.000Z'),
      version: 3,
      createdAt: new Date('2026-07-01T09:00:00.000Z'),
      updatedAt: new Date('2026-07-02T09:00:00.000Z'),
      createdById: 'usr_creator',
      reporterId: 'usr_reporter',
      reporter: {
        id: 'usr_reporter',
        displayName: 'Reporter',
        avatarAsset: null,
      },
      parent: null,
      subtasks: [
        { id: 'sub_1', number: '2', title: 'Done', status: 'DONE' },
        { id: 'sub_2', number: '3', title: 'Open', status: 'NEW' },
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

  it('replaces the active responsible selected through the legacy form', async () => {
    const task = {
      id: 'task_1',
      workspaceId: 'wrk_1',
      companyId: 'cmp_1',
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    const updateManyCall = tx.taskParticipant.updateMany.mock.calls[0]?.[0] as {
      where: {
        taskId: string
        userId: { not: string }
        role: string
        removedAt: null
      }
      data: { removedAt: Date }
    }
    expect(updateManyCall.where).toEqual({
      taskId: task.id,
      userId: { not: 'usr_owner' },
      role: 'RESPONSIBLE',
      removedAt: null,
    })
    expect(updateManyCall.data.removedAt).toBeInstanceOf(Date)
  })
})

describe('completed task restoration', () => {
  function setup(responsible = true, status = 'DONE', version = 2, reporterId = 'poster') {
    const task = { id: 'tsk_1', reporterId, version, status, companyId: 'cmp_1' }
    const tx = { task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ ...task, version: 3, status: 'IN_PROGRESS' }) }, taskParticipant: { findMany: vi.fn().mockResolvedValue([]) }, auditEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn() } }
    const service = new TaskCompatibilityService({ taskParticipant: { findFirst: vi.fn().mockResolvedValue(responsible ? { id: 'participant' } : null) }, $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)) } as never, {} as never, { readableTask: vi.fn().mockResolvedValue(task) } as never, {} as never, {} as never, { projectTask: vi.fn() } as never, {} as never)
    return { service, tx }
  }
  it('restores a completed task, clears completedAt, and records the event', async () => {
    const { service, tx } = setup()
    await expect(service.transition(principal(), 'tsk_1', { action: 'RETURN_TO_WORK', expectedVersion: 2 })).resolves.toEqual({ version: 3, status: 'IN_PROGRESS' })
    expect(tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'IN_PROGRESS', completedAt: null, version: { increment: 1 } } }))
    expect(tx.outboxEvent.create).toHaveBeenCalled()
  })
  it('allows the poster to restore a completed task without being responsible', async () => {
    const { service } = setup(false, 'DONE', 2, 'usr_viewer')
    await expect(service.transition(principal(), 'tsk_1', { action: 'RETURN_TO_WORK', expectedVersion: 2 })).resolves.toEqual({ version: 3, status: 'IN_PROGRESS' })
  })
  it('rejects unrelated participants, archived tasks, and stale versions', async () => {
    await expect(setup(false).service.transition(principal(), 'tsk_1', { action: 'RETURN_TO_WORK', expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    await expect(setup(true, 'ARCHIVED').service.transition(principal(), 'tsk_1', { action: 'RETURN_TO_WORK', expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    await expect(setup(true, 'DONE', 3).service.transition(principal(), 'tsk_1', { action: 'RETURN_TO_WORK', expectedVersion: 2 })).rejects.toMatchObject({ status: 409 })
  })
})

describe('task activity participant names', () => {
  it.each([{ userId: 'watcher' }, { userIds: ['watcher', 'second'] }])('resolves participant names separately from the actor for %j', async (references) => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'actor', displayName: 'Автор зміни', avatarAsset: null }, { id: 'watcher', displayName: 'Перший користувач', avatarAsset: null }, { id: 'second', displayName: 'Другий користувач', avatarAsset: null }])
    const service = serviceWith({
      auditEvent: { findMany: vi.fn().mockResolvedValue([{ id: 'event', action: 'task.participant_changed', actorId: 'actor', safeDiffJson: JSON.stringify({ ...references, role: 'WATCHER', change: 'MENTION_ADDED' }), createdAt: new Date('2026-10-14T12:22:00Z') }]) },
      user: { findMany },
    }, { readableTask: vi.fn().mockResolvedValue({ id: 'task' }) })
    const result = await service.activity(principal(), 'task')
    expect(result.items[0]?.label).toBe('userIds' in references ? 'Змінено спостерігач: Перший користувач, Другий користувач' : 'Змінено спостерігач: Перший користувач')
    expect(result.items[0]?.actor?.displayName).toBe('Автор зміни')
    const lookup = findMany.mock.calls[0]?.[0] as { where: { id: { in: string[] } } }
    expect(lookup.where.id.in).toEqual('userIds' in references ? ['actor', 'watcher', 'second'] : ['actor', 'watcher'])
  })
})
