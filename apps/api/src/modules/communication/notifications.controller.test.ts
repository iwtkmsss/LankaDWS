import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { NotificationsController } from './notifications.controller.js'
import type { LankaDWSRequest } from '../../common/request-context.js'

describe('NotificationsController chat read reconciliation', () => {
  it.each([
    ['all', {}],
    ['unread', { readAt: null }],
    ['mentions', { category: 'MENTION' }],
  ])('lists %s notifications only for the current recipient', async (tab, filter) => {
    const items = [{ id: 'notification-1' }]
    // Two reconciliations find nothing, then the list itself runs.
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(items).mockResolvedValue([])
    const controller = new NotificationsController({ notification: { findMany } } as unknown as PrismaService)
    expect(await controller.list({ principal: { userId: 'user-1' } } as LankaDWSRequest, tab)).toEqual({ items })
    expect(findMany).toHaveBeenNthCalledWith(3, {
      where: { recipientId: 'user-1', NOT: { category: 'CHAT', dedupeKey: { startsWith: 'chat:' } }, ...filter, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  })

  it('lists unread first and each group newest first, not by when it was read', async () => {
    const unread = [{ id: 'unread-new' }, { id: 'unread-old' }]
    const read = [{ id: 'read-new' }]
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(unread).mockResolvedValueOnce(read)
    const controller = new NotificationsController({ notification: { findMany } } as unknown as PrismaService)
    expect(await controller.list({ principal: { userId: 'user-1' } } as LankaDWSRequest, 'all')).toEqual({ items: [...unread, ...read] })
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ readAt: { not: null } }) as unknown, orderBy: { createdAt: 'desc' }, take: 98,
    }))
  })

  it('reads the notifications of a task the person can no longer open', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const taskFindMany = vi.fn().mockResolvedValue([{ id: 'open' }])
    const controller = new NotificationsController({
      notification: { findMany: vi.fn().mockResolvedValue([{ entityId: 'open' }, { entityId: 'revoked' }]), updateMany },
      task: { findMany: taskFindMany },
    } as unknown as PrismaService)
    await (controller as unknown as { reconcileTaskAccess(principal: unknown): Promise<void> })
      .reconcileTaskAccess({ userId: 'user-1', workspaceId: 'workspace', accountType: 'USER' })
    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([{ participants: { some: { userId: 'user-1', removedAt: null } } }]) as unknown }) as unknown,
    }))
    expect(updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', entityType: 'TASK', entityId: { in: ['revoked'] }, readAt: null },
      data: { readAt: expect.any(Date) as unknown },
    })
  })

  it('keeps only the archive alert of an archived task as news', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 5 })
    const controller = new NotificationsController({
      notification: { findMany: vi.fn().mockResolvedValue([{ entityId: 'finished' }]), updateMany },
      task: { findMany: vi.fn().mockResolvedValue([{ id: 'finished', archivedAt: new Date('2026-10-30T10:00:00Z') }]) },
    } as unknown as PrismaService)
    await (controller as unknown as { reconcileTaskAccess(principal: unknown): Promise<void> })
      .reconcileTaskAccess({ userId: 'user-1', workspaceId: 'workspace', accountType: 'USER' })
    expect(updateMany).toHaveBeenCalledOnce()
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        recipientId: 'user-1', entityType: 'TASK', entityId: { in: ['finished'] }, readAt: null,
        NOT: { dedupeKey: { contains: ':task.archived:' } },
      },
      data: { readAt: expect.any(Date) as unknown },
    })
  })

  it('reads reactions but not messages when a thread is opened', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const controller = new NotificationsController({ notification: { updateMany } } as unknown as PrismaService)
    await controller.readEntity({ principal: { userId: 'user-1' } } as LankaDWSRequest, {
      entityType: 'MESSAGE_THREAD', entityId: 'thread-1', before: '2026-09-01T10:00:00.000Z',
    })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ dedupeKey: { startsWith: 'chat-participant-added:' } }, { category: 'REACTION' }] }],
      }) as unknown,
    }))
  })

  it('reads only the current recipient and opened entity through the loaded snapshot', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const publishSummary = vi.fn()
    const controller = new NotificationsController({ notification: { updateMany } } as unknown as PrismaService, { publishSummary } as never)
    const before = '2026-09-01T10:00:00.000Z'
    expect(await controller.readEntity({ principal: { userId: 'user-1' } } as LankaDWSRequest, {
      entityType: 'TASK', entityId: 'task-1', before,
    })).toEqual({ updated: 2 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', entityType: 'TASK', entityId: 'task-1', readAt: null, createdAt: { lte: new Date(before) },
        OR: [{ deliveredAt: null }, { deliveredAt: { lte: new Date(before) } }],
      },
      data: { readAt: expect.any(Date) as unknown },
    })
    expect(publishSummary).toHaveBeenCalledWith(['user-1'], ['notifications'])
  })

  it.each([
    ['ahead of', '2099-01-01T10:00:00.000Z'],
    ['behind', '2000-01-01T10:00:00.000Z'],
  ])('uses the server clock when the client clock is %s it', async (_label, before) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const controller = new NotificationsController({ notification: { updateMany } } as unknown as PrismaService)
    const started = Date.now()
    expect(await controller.readEntity({ principal: { userId: 'user-1' } } as LankaDWSRequest, {
      entityType: 'TASK', entityId: 'task-1', before, loadedAgoMs: 1_000,
    })).toEqual({ updated: 1 })
    const calls = updateMany.mock.calls as Array<[{ where: { createdAt: { lte: Date } } }]>
    const cutoff = calls[0][0].where.createdAt.lte.getTime()
    expect(cutoff).toBeGreaterThanOrEqual(started - 1_000)
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 1_000)
  })

  it.each([
    { entityType: 'TASK', entityId: 'task-1', before: '2026-09-01T10:00:00.000Z', loadedAgoMs: -1 },
    { entityType: 'UNKNOWN', entityId: 'thread-1', before: '2026-09-01T10:00:00.000Z' },
    { entityType: 'TASK', entityId: '', before: '2026-09-01T10:00:00.000Z' },
    { entityType: 'TASK', entityId: 'task-1', before: '2099-01-01T10:00:00.000Z' },
    { entityType: 'TASK', entityId: 'task-1', before: 'invalid' },
  ])('rejects invalid entity read requests: %j', async (body) => {
    const updateMany = vi.fn()
    const controller = new NotificationsController({ notification: { updateMany } } as unknown as PrismaService)
    await expect(controller.readEntity({ principal: { userId: 'user-1' } } as LankaDWSRequest, body)).rejects.toMatchObject({ status: 400 })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it('splits task unread counts by current roles and excludes inaccessible tasks', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { entityId: 'responsible', _count: { _all: 3 } },
      { entityId: 'collaborator', _count: { _all: 2 } },
      { entityId: 'revoked', _count: { _all: 8 } },
    ])
    const findMany = vi.fn().mockResolvedValue([
      { id: 'responsible', reporterId: 'user-1', participants: [{ role: 'RESPONSIBLE' }] },
      { id: 'collaborator', reporterId: 'someone', participants: [{ role: 'COLLABORATOR' }] },
    ])
    const where = { workspaceId: 'workspace', archivedAt: null, AND: [{ status: { in: ['NEW', 'IN_PROGRESS', 'IN_REVIEW'] } }] }
    const listWhere = vi.fn().mockReturnValue(where)
    const controller = new NotificationsController({ notification: { groupBy }, task: { findMany } } as unknown as PrismaService, undefined, { listWhere } as never)
    const request = { principal: { userId: 'user-1', workspaceId: 'workspace', accountType: 'USER' } } as LankaDWSRequest
    const result = await controller.taskSummary(request, { preset: 'DUE_SOON', search: 'design', company: 'company-1' })
    expect(result).toEqual({ RESPONSIBLE: 3, CO_EXECUTOR: 2, CREATOR: 3, OBSERVER: 0, ALL: 5 })
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { recipientId: 'user-1', entityType: 'TASK', readAt: null } }))
    expect(listWhere).toHaveBeenCalledWith(request.principal, 'company-1', undefined, { preset: 'DUE_SOON', search: 'design', company: 'company-1' })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...where, id: { in: ['responsible', 'collaborator', 'revoked'] } } }))
  })
  it('does not show unread badges for tasks excluded by the current list filters', async () => {
    const groupBy = vi.fn().mockResolvedValue([{ entityId: 'completed', _count: { _all: 3 } }])
    const findMany = vi.fn().mockResolvedValue([])
    const listWhere = vi.fn().mockReturnValue({ archivedAt: null, status: 'IN_PROGRESS' })
    const controller = new NotificationsController({ notification: { groupBy }, task: { findMany } } as unknown as PrismaService, undefined, { listWhere } as never)
    expect(await controller.taskSummary({ principal: { userId: 'user-1' } } as LankaDWSRequest, { status: 'IN_PROGRESS' }))
      .toEqual({ RESPONSIBLE: 0, CO_EXECUTOR: 0, CREATOR: 0, OBSERVER: 0, ALL: 0 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['completed'] }, archivedAt: null, status: 'IN_PROGRESS' } }))
  })
  it('counts unread task notifications for the current recipient, including mentions', async () => {
    const count = vi.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(3)
    const controller = new NotificationsController({ notification: { count } } as unknown as PrismaService)
    const result = await (controller as unknown as { summaryCounts(userId: string): Promise<unknown> }).summaryCounts('user-1')
    expect(result).toEqual({ unread: 7, tasks: 3 })
    expect(count).toHaveBeenLastCalledWith({ where: { recipientId: 'user-1', entityType: 'TASK', readAt: null } })
  })
  it('marks only notifications whose source message is covered by the thread read marker', async () => {
    const prisma = {
      notification: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'notification-read', entityId: 'thread-1', dedupeKey: 'chat:message-1:user-1' },
          { id: 'notification-new', entityId: 'thread-1', dedupeKey: 'chat:message-3:user-1' },
          { id: 'notification-edit', entityId: 'thread-1', dedupeKey: 'chat:message-1:mention:v2:user-1' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      threadParticipant: {
        findMany: vi.fn().mockResolvedValue([
          { threadId: 'thread-1', lastReadMessageId: 'message-2' },
        ]),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'message-1', threadId: 'thread-1', createdAt: new Date('2026-08-31T10:00:00.000Z') },
          { id: 'message-2', threadId: 'thread-1', createdAt: new Date('2026-08-31T10:01:00.000Z') },
          { id: 'message-3', threadId: 'thread-1', createdAt: new Date('2026-08-31T10:02:00.000Z') },
        ]),
      },
    }
    const controller = new NotificationsController(prisma as unknown as PrismaService)

    await (controller as unknown as {
      reconcileChatReads(userId: string): Promise<void>
    }).reconcileChatReads('user-1')

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['notification-read'] },
        recipientId: 'user-1',
        readAt: null,
      },
      data: { readAt: expect.any(Date) as unknown },
    })
  })
})
