import { Injectable, Optional, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { tap, type Observable } from 'rxjs'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ChatRealtimeService } from '../communication/chat-realtime.service.js'

/**
 * Tells the people on a task that it changed, once the change is committed.
 * Several task services write notifications without a realtime signal, so a
 * person with the task open would otherwise see them as unread until the slow
 * badge fallback. The signal lets the open page reload and mark them read.
 */
@Injectable()
export class TaskChangeSignalInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realtime?: ChatRealtimeService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LankaDWSRequest>()
    const taskId = request.params.id
    const route = (request.route as { path?: string } | undefined)?.path ?? ''
    // A personal pin changes nothing that other people can see.
    if (request.method === 'GET' || typeof taskId !== 'string' || route.endsWith('/user-state')) return next.handle()
    return next.handle().pipe(tap(() => {
      // The response must not depend on a best-effort signal; the fallback poll covers a miss.
      void this.signal(taskId, request.principal?.userId).catch(() => undefined)
    }))
  }

  private async signal(taskId: string, actorId: string | undefined): Promise<void> {
    if (!this.realtime) return
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        workspaceId: true,
        createdById: true,
        reporterId: true,
        participants: { where: { removedAt: null }, select: { userId: true } },
      },
    })
    if (!task) return
    // An administrator can have any task open without being on it.
    const admins = await this.prisma.user.findMany({
      where: { workspaceId: task.workspaceId, accountType: 'ADMIN', isActive: true },
      select: { id: true },
    })
    const people = new Set([
      task.createdById, task.reporterId,
      ...task.participants.map(({ userId }) => userId),
      ...admins.map(({ id }) => id),
    ])
    if (actorId) people.delete(actorId)
    this.realtime.publishSummary(people, ['notifications'])
  }
}
