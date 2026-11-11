import { z } from 'zod'
import { Body, Controller, Get, Optional, Param, Patch, Query, Req } from '@nestjs/common'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import { isGlobalAdmin, principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { parseBody } from '../../common/validation.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'
import { TasksService } from '../tasks/tasks.service.js'

// A chat message is already counted and listed by the chat itself. Its stored
// row exists only to be reconciled, so the inbox neither shows nor counts it.
// Mentions and reactions are alerts of their own and stay.
const readAllBodySchema = z.object({ tab: z.string().optional() })
const readBodySchema = z.object({ read: z.boolean() })

const inboxWhere = { NOT: { category: 'CHAT', dedupeKey: { startsWith: 'chat:' } } }

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime?: ChatRealtimeService,
    @Optional() private readonly tasks?: TasksService,
  ) {}

  private tabWhere(tab: string) {
    if (tab === 'unread') return { readAt: null }
    if (tab === 'mentions') return { category: 'MENTION' }
    return {}
  }

  @Get()
  async list(@Req() request: LankaDWSRequest, @Query('tab') tab = 'all') {
    const principal = principalFrom(request)
    await this.reconcileChatReads(principal.userId)
    await this.reconcileTaskAccess(principal)
    const where = { recipientId: principal.userId, ...inboxWhere, ...this.tabWhere(tab) }
    // Unread first, each group newest first. Sorting by readAt would instead
    // order the read rows by when they happened to be read.
    const unread = await this.prisma.notification.findMany({
      where: { ...where, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const read = tab === 'unread' || unread.length >= 100 ? [] : await this.prisma.notification.findMany({
      where: { ...where, readAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100 - unread.length,
    })
    return { items: [...unread, ...read] }
  }

  @Get('summary')
  async summary(@Req() request: LankaDWSRequest) {
    const principal = principalFrom(request)
    await this.reconcileChatReads(principal.userId)
    await this.reconcileTaskAccess(principal)
    return this.summaryCounts(principal.userId)
  }

  @Get('tasks-summary')
  async taskSummary(@Req() request: LankaDWSRequest, @Query() query: Record<string, string | undefined> = {}) {
    const principal = principalFrom(request)
    if (!this.tasks) throw new Error('TasksService is required for task notification counts')
    const taskWhere = this.tasks.listWhere(principal, query.company, undefined, query)
    const notifications = await this.prisma.notification.groupBy({
      by: ['entityId'],
      where: { recipientId: principal.userId, entityType: 'TASK', readAt: null },
      _count: { _all: true },
    })
    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: notifications.map((item) => item.entityId) },
        ...taskWhere,
      },
      select: { id: true, reporterId: true, participants: { where: { userId: principal.userId, removedAt: null }, select: { role: true } } },
    })
    const counts = { RESPONSIBLE: 0, CO_EXECUTOR: 0, CREATOR: 0, OBSERVER: 0, ALL: 0 }
    const byTask = new Map(notifications.map((item) => [item.entityId, item._count._all]))
    for (const task of tasks) {
      const unread = byTask.get(task.id) ?? 0
      counts.ALL += unread
      if (task.reporterId === principal.userId) counts.CREATOR += unread
      for (const participant of task.participants) {
        const role = participant.role === 'RESPONSIBLE' ? 'RESPONSIBLE' : participant.role === 'COLLABORATOR' ? 'CO_EXECUTOR' : 'OBSERVER'
        counts[role] += unread
      }
    }
    return counts
  }

  @Patch('read-all')
  async readAll(
    @Req() request: LankaDWSRequest,
    @Body() rawBody: unknown,
  ) {
    const principal = principalFrom(request)
    const body = parseBody(readAllBodySchema, rawBody ?? {})
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: principal.userId,
        readAt: null,
        ...inboxWhere,
        ...this.tabWhere(body.tab ?? 'all'),
      },
      data: { readAt: new Date() },
    })
    if (result.count > 0) this.realtime?.publishSummary([principal.userId], ['notifications'])
    return { updated: result.count }
  }

  @Patch('read-entity')
  async readEntity(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    const parsed = z.object({
      entityType: z.enum(['TASK', 'FEED_POST', 'USER', 'MESSAGE_THREAD']),
      entityId: z.string().min(1).max(200),
      before: z.string().datetime(),
      loadedAgoMs: z.number().int().min(0).optional(),
    }).strict().safeParse(body)
    if (!parsed.success) throw badRequest('notification_read_invalid')
    const principal = principalFrom(request)
    const now = new Date()
    // `before` is on the client's clock, which can drift from the server's and
    // would leave an open entity unread. How long ago it loaded does not drift.
    const before = parsed.data.loadedAgoMs === undefined
      ? new Date(parsed.data.before)
      : new Date(now.getTime() - parsed.data.loadedAgoMs)
    if (before > now) throw badRequest('notification_read_invalid')
    // Like the individual read action, this changes only the caller's inbox.
    // The cutoff leaves notifications about later, unseen changes unread.
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: principal.userId,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        readAt: null,
        createdAt: { lte: before },
        OR: [{ deliveredAt: null }, { deliveredAt: { lte: before } }],
        // Messages and mentions follow the thread's read marker instead.
        ...(parsed.data.entityType === 'MESSAGE_THREAD'
          ? { AND: [{ OR: [{ dedupeKey: { startsWith: 'chat-participant-added:' } }, { category: 'REACTION' }] }] }
          : {}),
      },
      data: { readAt: now },
    })
    if (result.count) this.realtime?.publishSummary([principal.userId], ['notifications'])
    return { updated: result.count }
  }

  @Patch(':id')
  async read(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() rawBody: unknown) {
    const principal = principalFrom(request)
    const body = parseBody(readBodySchema, rawBody)
    const result = await this.prisma.notification.updateMany({ where: { id, recipientId: principal.userId }, data: { readAt: body.read ? new Date() : null } })
    if (!result.count) throw notFound()
    this.realtime?.publishSummary([principal.userId], ['notifications'])
    return { read: body.read }
  }

  /**
   * Someone removed from a task can no longer open it, so its notifications
   * could never be read by opening the source and would stay unread forever.
   * An archived task is finished and off the task list: only the alert that it
   * was archived remains news, and earlier ones would inflate the badge.
   */
  private async reconcileTaskAccess(principal: AuthPrincipal): Promise<void> {
    const unread = await this.prisma.notification.findMany({
      where: { recipientId: principal.userId, entityType: 'TASK', readAt: null },
      select: { entityId: true },
      distinct: ['entityId'],
    })
    if (!unread.length) return
    const taskIds = unread.map((notification) => notification.entityId)
    const readable = await this.prisma.task.findMany({
      where: {
        id: { in: taskIds },
        workspaceId: principal.workspaceId,
        ...(isGlobalAdmin(principal) ? {} : {
          OR: [
            { createdById: principal.userId },
            { reporterId: principal.userId },
            { participants: { some: { userId: principal.userId, removedAt: null } } },
          ],
        }),
      },
      select: { id: true, archivedAt: true },
    })
    const readableIds = new Set(readable.map((task) => task.id))
    const closed = taskIds.filter((taskId) => !readableIds.has(taskId))
    const archived = readable.filter((task) => task.archivedAt).map((task) => task.id)
    const readAt = new Date()
    if (closed.length) {
      await this.prisma.notification.updateMany({
        where: { recipientId: principal.userId, entityType: 'TASK', entityId: { in: closed }, readAt: null },
        data: { readAt },
      })
    }
    if (archived.length) {
      await this.prisma.notification.updateMany({
        where: {
          recipientId: principal.userId, entityType: 'TASK', entityId: { in: archived }, readAt: null,
          NOT: { dedupeKey: { contains: ':task.archived:' } },
        },
        data: { readAt },
      })
    }
  }

  private async reconcileChatReads(userId: string): Promise<void> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        entityType: 'MESSAGE_THREAD',
        // Only categories whose dedupe key names the message that triggered
        // them. A reaction points at a message the recipient already wrote and
        // has read, so reconciling it would hide the notification instantly.
        category: { in: ['CHAT', 'MENTION'] },
        readAt: null,
      },
      select: { id: true, entityId: true, dedupeKey: true },
    })
    if (!notifications.length) return
    const participants = await this.prisma.threadParticipant.findMany({
      where: {
        userId,
        leftAt: null,
        lastReadMessageId: { not: null },
        threadId: { in: [...new Set(notifications.map((item) => item.entityId))] },
      },
      select: { threadId: true, lastReadMessageId: true },
    })
    const markerByThread = new Map(participants.flatMap((participant) =>
      participant.lastReadMessageId ? [[participant.threadId, participant.lastReadMessageId] as const] : []))
    const notificationMessageById = new Map(notifications.flatMap((notification) => {
      const parts = notification.dedupeKey.split(':')
      // A mention added by an edit is a new event even if the original message
      // was read earlier. Reconcile only the original message notifications.
      const messageId = parts.length === 3 && parts[0] === 'chat' ? parts[1] : undefined
      return messageId ? [[notification.id, messageId] as const] : []
    }))
    const messageIds = [
      ...new Set([
        ...markerByThread.values(),
        ...notificationMessageById.values(),
      ]),
    ]
    if (!messageIds.length) return
    const messages = await this.prisma.message.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, threadId: true, createdAt: true },
    })
    const messageById = new Map(messages.map((message) => [message.id, message]))
    const readNotificationIds = notifications.flatMap((notification) => {
      const marker = messageById.get(markerByThread.get(notification.entityId) ?? '')
      const target = messageById.get(notificationMessageById.get(notification.id) ?? '')
      if (!marker || !target || marker.threadId !== notification.entityId || target.threadId !== notification.entityId) return []
      const markerTime = marker.createdAt.getTime()
      const targetTime = target.createdAt.getTime()
      return markerTime > targetTime || (markerTime === targetTime && marker.id >= target.id)
        ? [notification.id]
        : []
    })
    if (!readNotificationIds.length) return
    await this.prisma.notification.updateMany({
      where: { id: { in: readNotificationIds }, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    })
  }

  private async summaryCounts(userId: string) {
    const [unread, tasks] = await Promise.all([
      this.prisma.notification.count({
        where: { recipientId: userId, readAt: null, ...inboxWhere },
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, entityType: 'TASK', readAt: null },
      }),
    ])
    return { unread, tasks }
  }
}
