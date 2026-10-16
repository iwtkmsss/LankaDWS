import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { MessagesService } from './messages.service.js'

describe('chat notification read boundaries', () => {
  it.each([false, true])('keeps newer and missing source notifications unread (existing marker: %s)', async (existing) => {
    const target = { id: 'message-2', createdAt: new Date('2026-09-01T10:01:00Z') }
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const publishSummary = vi.fn()
    const publish = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      message: {
        findFirst: vi.fn().mockResolvedValue(target),
        findUnique: vi.fn().mockResolvedValue(target),
        findMany: vi.fn().mockResolvedValue([
          { id: 'message-1', createdAt: new Date('2026-09-01T10:00:00Z') },
          target,
          { id: 'message-3', createdAt: new Date('2026-09-01T10:02:00Z') },
        ]),
      },
      notification: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'read', category: 'CHAT', dedupeKey: 'chat:message-1:user-1' },
          { id: 'reaction', category: 'REACTION', dedupeKey: 'chat:message-1:reaction:LIKE:user-2' },
          { id: 'new', category: 'MENTION', dedupeKey: 'chat:message-3:user-1' },
          { id: 'missing', category: 'CHAT', dedupeKey: 'chat:message-missing:user-1' },
          { id: 'participant', category: 'CHAT', dedupeKey: 'chat-participant-added:thread-1:user-1:v2' },
        ]), updateMany,
      },
      threadParticipant: { update: vi.fn().mockResolvedValue({ lastReadMessageId: target.id, version: 2 }) },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    }
    const service = new MessagesService(prisma as never, {} as never, {} as never, { publish, publishSummary } as never)
    Object.assign(service, {
      readableThread: vi.fn().mockResolvedValue({ participants: [{ id: 'participant-1', userId: 'user-1', leftAt: null, version: 1, lastReadMessageId: existing ? target.id : null }] }),
    })
    await service.markRead({ userId: 'user-1' } as AuthPrincipal, 'thread-1', { lastReadMessageId: target.id })
    expect(updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', entityType: 'MESSAGE_THREAD', entityId: 'thread-1', id: { in: ['read', 'reaction', 'participant'] }, readAt: null },
      data: { readAt: expect.any(Date) as unknown },
    })
    if (existing) expect(publishSummary).toHaveBeenCalledWith(['user-1'], ['notifications'])
    else expect(publish).toHaveBeenCalledWith('thread-1', 'thread.read')
  })
})
