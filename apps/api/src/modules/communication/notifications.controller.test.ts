import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { NotificationsController } from './notifications.controller.js'

describe('NotificationsController chat read reconciliation', () => {
  it('marks only notifications whose source message is covered by the thread read marker', async () => {
    const prisma = {
      notification: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'notification-read', entityId: 'thread-1', dedupeKey: 'chat:message-1:user-1' },
          { id: 'notification-new', entityId: 'thread-1', dedupeKey: 'chat:message-3:user-1' },
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
