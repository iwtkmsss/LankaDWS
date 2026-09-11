import { Injectable, type MessageEvent } from '@nestjs/common'
import { concatMap, Observable, Subject } from 'rxjs'
import type { ChatRealtimeEvent, RealtimeSummaryChanged } from '@lankadws/contracts'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { unauthorized } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class ChatRealtimeService {
  private readonly threadStreams = new Map<string, Subject<MessageEvent>>()
  private readonly userStreams = new Map<string, Subject<MessageEvent>>()
  private sequence = 0

  constructor(private readonly prisma: PrismaService) {}

  async canAccess(principal: AuthPrincipal, threadId: string): Promise<boolean> {
    if (isGlobalAdmin(principal)) {
      return Boolean(await this.prisma.messageThread.findFirst({
        where: { id: threadId, workspaceId: principal.workspaceId },
        select: { id: true },
      }))
    }
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
    }).pipe(concatMap(async (event) => {
      await this.assertSession(principal)
      return event
    }))
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
    }).pipe(concatMap(async (event) => {
      await this.assertSession(principal)
      return event
    }))
  }

  private async assertSession(principal: AuthPrincipal): Promise<void> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: principal.sessionId },
      include: { user: { include: { primaryCompany: true } } },
    })
    const now = Date.now()
    if (!session || session.userId !== principal.userId || session.revokedAt || !session.user.isActive
      || session.expiresAt.getTime() <= now
      || session.lastSeenAt.getTime() + getConfig().SESSION_IDLE_MINUTES * 60_000 <= now
      || session.authorizationVersion !== session.user.authorizationVersion
      || (session.user.accountType === 'USER' && !session.user.primaryCompany?.isActive)) {
      throw unauthorized()
    }
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
        workspaceId: true,
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
        workspaceId: thread.workspaceId,
        isActive: true,
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

  publishSummary(userIds: Iterable<string>, kinds: RealtimeSummaryChanged['kinds']): void {
    const recipientIds = new Set(userIds)
    if (!recipientIds.size) return
    this.sequence += 1
    const event: MessageEvent = {
      id: `${Date.now()}-${this.sequence}`,
      type: 'summary',
      data: {
        kinds,
        occurredAt: new Date().toISOString(),
      } satisfies RealtimeSummaryChanged,
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
