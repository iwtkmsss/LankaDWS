import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

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
    const [rows, counts] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: principal.userId, ...this.tabWhere(tab) },
        orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.summaryFor(principal.userId),
    ])
    return { items: rows, counts }
  }

  @Get('summary')
  async summary(@Req() request: BertRequest) {
    return this.summaryFor(principalFrom(request).userId)
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
    return { updated: result.count }
  }

  @Patch(':id')
  async read(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { read: boolean }) {
    const result = await this.prisma.notification.updateMany({ where: { id, recipientId: principalFrom(request).userId }, data: { readAt: body.read ? new Date() : null } })
    if (!result.count) throw notFound()
    return { read: body.read }
  }

  private async summaryFor(userId: string) {
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
