import { describe, expect, it, vi } from 'vitest'
import type { MessageEvent } from '@nestjs/common'
import { chatRealtimeEventSchema, realtimeSummaryChangedSchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_one',
  workspaceId: 'workspace-1',
  username: 'one',
  displayName: 'User One',
  accountType: 'USER',
  primaryCompanyId: 'company-1',
  allowedCompanyIds: ['company-1'],
  authorizationVersion: 1,
  sessionId: 'session-1',
  authAssurance: 1,
  restricted: false,
}

describe('ChatRealtimeService user stream', () => {
  it('publishes one typed event to each active scoped participant', async () => {
    const groupMemberFindMany = vi.fn()
    const prismaMock = {
      userSession: { findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve({
        userId: where.id === 'session-1' ? 'usr_one' : 'usr_two',
        revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(), authorizationVersion: 1,
        user: { isActive: true, accountType: 'USER', authorizationVersion: 1, primaryCompany: { isActive: true } },
      })) },
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

    await vi.waitFor(() => expect(first.filter((event) => event.type === 'chat')).toHaveLength(1))
    await vi.waitFor(() => expect(second.filter((event) => event.type === 'chat')).toHaveLength(1))
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

  it('publishes a summary refresh only to the requested connected user', async () => {
    const prisma = {
      userSession: { findUnique: vi.fn().mockResolvedValue({
        userId: principal.userId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(), authorizationVersion: 1,
        user: { isActive: true, accountType: 'USER', authorizationVersion: 1, primaryCompany: { isActive: true } },
      }) },
    }
    const realtime = new ChatRealtimeService(prisma as never)
    const events: MessageEvent[] = []
    const subscription = realtime.userStream(principal).subscribe((event) => events.push(event))

    realtime.publishSummary([principal.userId], ['feed', 'notifications'])

    await vi.waitFor(() => expect(events.some((event) => event.type === 'summary')).toBe(true))
    const summary = realtimeSummaryChangedSchema.parse(events.find((event) => event.type === 'summary')?.data)
    expect(summary.kinds).toEqual(['feed', 'notifications'])
    subscription.unsubscribe()
  })
})


describe('ChatRealtimeService revoked sessions', () => {
  it.each(['user', 'thread'])('closes an existing %s stream after deactivation without delivering another event', async (kind) => {
    let active = true
    const prisma = {
      userSession: { findUnique: vi.fn(() => Promise.resolve({
        userId: principal.userId, revokedAt: active ? null : new Date(),
        expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(), authorizationVersion: 1,
        user: { isActive: active, accountType: 'USER', authorizationVersion: active ? 1 : 2, primaryCompany: { isActive: true } },
      })) },
      messageThread: { findFirst: vi.fn().mockResolvedValue({ id: 'thread-1' }) },
    }
    const realtime = new ChatRealtimeService(prisma as never)
    const events: MessageEvent[] = []
    const error = vi.fn()
    const stream = kind === 'user' ? realtime.userStream(principal) : realtime.stream({ ...principal, accountType: 'ADMIN' }, 'thread-1')
    vi.useFakeTimers()
    const subscription = stream.subscribe({ next: (event) => events.push(event), error })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(1)
    active = false
    try {
      await vi.advanceTimersByTimeAsync(15_000)
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
      expect(events).toHaveLength(1)
      expect(subscription.closed).toBe(true)
    } finally {
      subscription.unsubscribe()
      vi.useRealTimers()
    }
  })
})
