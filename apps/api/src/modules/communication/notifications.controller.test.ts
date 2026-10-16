import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { NotificationsController } from './notifications.controller.js'
import type { LankaDWSRequest } from '../../common/request-context.js'

describe('NotificationsController chat read reconciliation', () => {
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
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(7).mockResolvedValueOnce(3)
    const controller = new NotificationsController({ notification: { count } } as unknown as PrismaService)
    const result = await (controller as unknown as { summaryCounts(userId: string): Promise<unknown> }).summaryCounts('user-1')
    expect(result).toEqual({ action: 1, unread: 7, tasks: 3 })
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
