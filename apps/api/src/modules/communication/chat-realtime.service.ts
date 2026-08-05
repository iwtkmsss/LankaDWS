import { Injectable, type MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import type { ChatRealtimeEvent } from '@bert-crm/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class ChatRealtimeService {
  private readonly threadStreams = new Map<string, Subject<MessageEvent>>()
  private readonly userStreams = new Map<string, Subject<MessageEvent>>()
  private sequence = 0

  constructor(private readonly prisma: PrismaService) {}

  async canAccess(principal: AuthPrincipal, threadId: string): Promise<boolean> {
    const participant = await this.prisma.threadParticipant.findFirst({
      where: {
        threadId,
        userId: principal.userId,
        leftAt: null,
        thread: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
        },
      },
      select: {
        id: true,
        thread: { select: { entityType: true, entityId: true } },
      },
    })
    if (!participant) return false
    if (participant.thread.entityType !== 'GROUP') return true
    if (!participant.thread.entityId) return false
    const membership = await this.prisma.groupMember.findFirst({
      where: {
        groupId: participant.thread.entityId,
        userId: principal.userId,
        leftAt: null,
        group: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    })
    return Boolean(membership)
  }

  stream(principal: AuthPrincipal, threadId: string): Observable<MessageEvent> {
    const source = this.threadSubject(threadId)
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false
      let queue = Promise.resolve()
      const enqueue = (event: MessageEvent) => {
        queue = queue.then(async () => {
          if (closed) return
          if (!await this.canAccess(principal, threadId)) {
            subscriber.next({
              type: 'reset',
              data: { reason: 'scope_changed', threadId },
            })
            subscriber.complete()
            closed = true
            return
          }
          subscriber.next(event)
        }).catch((error: unknown) => subscriber.error(error))
      }
      subscriber.next({
        type: 'ready',
        retry: 3_000,
        data: { threadId, connectedAt: new Date().toISOString() },
      })
      const subscription = source.subscribe((event) => enqueue(event))
      const heartbeat = setInterval(() => enqueue({
        type: 'ping',
        data: { occurredAt: new Date().toISOString() },
      }), 15_000)
      heartbeat.unref()
      return () => {
        closed = true
        clearInterval(heartbeat)
        subscription.unsubscribe()
        if (!source.observed) this.threadStreams.delete(threadId)
      }
    })
  }

  userStream(principal: AuthPrincipal): Observable<MessageEvent> {
    const source = this.userSubject(principal.userId)
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        type: 'ready',
        retry: 3_000,
        data: { connectedAt: new Date().toISOString() },
      })
      const subscription = source.subscribe(subscriber)
      const heartbeat = setInterval(() => subscriber.next({
        type: 'ping',
        data: { occurredAt: new Date().toISOString() },
      }), 15_000)
      heartbeat.unref()
      return () => {
        clearInterval(heartbeat)
        subscription.unsubscribe()
        if (!source.observed) this.userStreams.delete(principal.userId)
      }
    })
  }

  async publish(
    threadId: string,
    eventType: ChatRealtimeEvent['eventType'],
    messageId: string | null = null,
  ): Promise<void> {
    this.sequence += 1
    const event: MessageEvent = {
      id: `${Date.now()}-${this.sequence}`,
      type: 'chat',
      data: {
        threadId,
        eventType,
        messageId,
        occurredAt: new Date().toISOString(),
      },
    }
    this.threadStreams.get(threadId)?.next(event)

    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      select: {
        companyId: true,
        entityType: true,
        entityId: true,
        participants: {
          where: { leftAt: null },
          select: { userId: true },
        },
      },
    })
    if (!thread?.companyId) return
    const activeUsers = await this.prisma.user.findMany({
      where: {
        id: { in: thread.participants.map((participant) => participant.userId) },
        isActive: true,
        OR: [{ primaryCompanyId: thread.companyId }, { accountType: 'ADMIN' }],
      },
      select: { id: true },
    })
    let recipientIds = activeUsers.map((user) => user.id)
    if (thread.entityType === 'GROUP') {
      if (!thread.entityId) return
      const memberships = await this.prisma.groupMember.findMany({
        where: {
          groupId: thread.entityId,
          userId: { in: recipientIds },
          leftAt: null,
          group: { companyId: thread.companyId, status: 'ACTIVE' },
        },
        select: { userId: true },
      })
      recipientIds = memberships.map((membership) => membership.userId)
    }
    for (const userId of recipientIds) this.userStreams.get(userId)?.next(event)
  }

  private threadSubject(threadId: string): Subject<MessageEvent> {
    const existing = this.threadStreams.get(threadId)
    if (existing) return existing
    const created = new Subject<MessageEvent>()
    this.threadStreams.set(threadId, created)
    return created
  }

  private userSubject(userId: string): Subject<MessageEvent> {
    const existing = this.userStreams.get(userId)
    if (existing) return existing
    const created = new Subject<MessageEvent>()
    this.userStreams.set(userId, created)
    return created
  }
}
