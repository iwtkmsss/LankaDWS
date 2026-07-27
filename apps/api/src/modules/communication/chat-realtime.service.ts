import { Injectable, type MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class ChatRealtimeService {
  private readonly streams = new Map<string, Subject<MessageEvent>>()
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
    const source = this.subject(threadId)
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
        if (!source.observed) this.streams.delete(threadId)
      }
    })
  }

  publish(threadId: string, eventType: string): void {
    const stream = this.streams.get(threadId)
    if (!stream) return
    this.sequence += 1
    stream.next({
      id: `${Date.now()}-${this.sequence}`,
      type: 'chat',
      data: {
        threadId,
        eventType,
        occurredAt: new Date().toISOString(),
      },
    })
  }

  private subject(threadId: string): Subject<MessageEvent> {
    const existing = this.streams.get(threadId)
    if (existing) return existing
    const created = new Subject<MessageEvent>()
    this.streams.set(threadId, created)
    return created
  }
}
