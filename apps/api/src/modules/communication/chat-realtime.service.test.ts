import { describe, expect, it, vi } from 'vitest'
import type { MessageEvent } from '@nestjs/common'
import { chatRealtimeEventSchema } from '@bert-crm/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_one',
  workspaceId: 'workspace-1',
  username: 'one',
  displayName: 'User One',
  displayRole: 'Employee',
  primaryCompanyId: 'company-1',
  allowedCompanyIds: ['company-1'],
  permissions: new Set(),
  authorizationVersion: 1,
  sessionId: 'session-1',
  authAssurance: 1,
  restricted: false,
}

describe('ChatRealtimeService user stream', () => {
  it('publishes one typed event to each active scoped participant', async () => {
    const groupMemberFindMany = vi.fn()
    const prismaMock = {
      messageThread: {
        findUnique: vi.fn().mockResolvedValue({
          companyId: 'company-1',
          entityType: null,
          entityId: null,
          participants: [{ userId: 'usr_one' }, { userId: 'usr_two' }],
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'usr_one' }, { id: 'usr_two' }]),
      },
      groupMember: {
        findMany: groupMemberFindMany,
      },
    }
    const prisma = prismaMock as unknown as PrismaService
    const realtime = new ChatRealtimeService(prisma)
    const first: MessageEvent[] = []
    const second: MessageEvent[] = []
    const firstSubscription = realtime.userStream(principal).subscribe((event) => first.push(event))
    const secondSubscription = realtime.userStream({
      ...principal,
      userId: 'usr_two',
      username: 'two',
      sessionId: 'session-2',
    }).subscribe((event) => second.push(event))

    await realtime.publish('thread-1', 'message.created', 'message-1')

    for (const events of [first, second]) {
      expect(events.filter((event) => event.type === 'chat')).toHaveLength(1)
      const event = chatRealtimeEventSchema.parse(
        events.find((item) => item.type === 'chat')?.data,
      )
      expect(event.threadId).toBe('thread-1')
      expect(event.eventType).toBe('message.created')
      expect(event.messageId).toBe('message-1')
      expect(typeof event.occurredAt).toBe('string')
    }
    expect(groupMemberFindMany).not.toHaveBeenCalled()
    firstSubscription.unsubscribe()
    secondSubscription.unsubscribe()
  })
})
