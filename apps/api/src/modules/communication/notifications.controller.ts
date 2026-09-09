import { sendUserNotificationSchema } from '@bert-crm/contracts'
import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { fingerprint, id } from '../../common/crypto.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime?: ChatRealtimeService,
  ) {}

  private tabWhere(tab: string) {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    if (tab === 'action') return { requiresAction: true, readAt: null }
    if (tab === 'unread') return { readAt: null }
    if (tab === 'mentions') return { category: 'MENTION' }
    if (tab === 'today') return { createdAt: { gte: startOfToday } }
    if (tab === 'earlier') return { createdAt: { lt: startOfToday } }
    return {}
  }

  @Get()
  async list(@Req() request: BertRequest, @Query('tab') tab = 'action') {
    const principal = principalFrom(request)
    await this.reconcileChatReads(principal.userId)
    const [rows, counts] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: principal.userId, ...this.tabWhere(tab) },
        orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.summaryCounts(principal.userId),
    ])
    return { items: rows, counts }
  }

  @Get('summary')
  async summary(@Req() request: BertRequest) {
    const userId = principalFrom(request).userId
    await this.reconcileChatReads(userId)
    return this.summaryCounts(userId)
  }

  @Post()
  async send(
    @Req() request: BertRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey?: string,
  ) {
    const parsed = sendUserNotificationSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('notification_invalid')
    const key = rawKey?.trim()
    if (!key || key.length > 200) throw badRequest('idempotency_key_required')
    const principal = principalFrom(request)
    if (parsed.data.recipientId === principal.userId) throw badRequest('notification_recipient_invalid')
    const recipient = await this.prisma.user.findFirst({
      where: {
        id: parsed.data.recipientId,
        workspaceId: principal.workspaceId,
        isActive: true,
      },
      select: { id: true, primaryCompanyId: true },
    })
    if (!recipient) throw notFound()

    const notificationId = id('ntf')
    const dedupeKey = `manual:${fingerprint(`${principal.userId}:${key}`, 'manual-notification')}`
    const notification = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.notification.upsert({
        where: { dedupeKey },
        create: {
          id: notificationId,
          recipientId: recipient.id,
          category: 'DIRECT',
          safeTitle: parsed.data.title,
          safeSnippet: `${principal.displayName}: ${parsed.data.body}`,
          entityType: 'USER_NOTIFICATION',
          entityId: notificationId,
          requiresAction: false,
          deliveredAt: new Date(),
          dedupeKey,
        },
        update: {},
      })
      if (saved.id === notificationId) {
        await tx.auditEvent.create({
          data: {
            id: id('aud'),
            workspaceId: principal.workspaceId,
            companyId: recipient.primaryCompanyId,
            actorType: 'USER',
            actorId: principal.userId,
            action: 'notification.sent',
            entityType: 'NOTIFICATION',
            entityId: saved.id,
            result: 'SUCCESS',
            risk: 'NORMAL',
            safeDiffJson: JSON.stringify({ recipientId: recipient.id, category: 'DIRECT' }),
            correlationId: request.correlationId ?? id('corr'),
          },
        })
      }
      return saved
    })
    if (notification.id === notificationId) this.realtime?.publishSummary([recipient.id], ['notifications'])
    return { id: notification.id, created: notification.id === notificationId }
  }

  @Patch('read-all')
  async readAll(
    @Req() request: BertRequest,
    @Body() body: { tab?: string },
  ) {
    const principal = principalFrom(request)
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: principal.userId,
        readAt: null,
        ...this.tabWhere(body.tab ?? 'all'),
      },
      data: { readAt: new Date() },
    })
    if (result.count > 0) this.realtime?.publishSummary([principal.userId], ['notifications'])
    return { updated: result.count }
  }

  @Patch(':id')
  async read(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { read: boolean }) {
    const principal = principalFrom(request)
    const result = await this.prisma.notification.updateMany({ where: { id, recipientId: principal.userId }, data: { readAt: body.read ? new Date() : null } })
    if (!result.count) throw notFound()
    this.realtime?.publishSummary([principal.userId], ['notifications'])
    return { read: body.read }
  }

  private async reconcileChatReads(userId: string): Promise<void> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        entityType: 'MESSAGE_THREAD',
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
      const messageId = notification.dedupeKey.split(':')[1]
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
    const [action, unread] = await Promise.all([
      this.prisma.notification.count({
        where: { recipientId: userId, requiresAction: true, readAt: null },
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ])
    return { action, unread }
  }
}
