import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { RequirePermissions } from '../auth/auth.decorators.js'

@Controller('notifications')
@RequirePermissions(Permission.NotificationsRead)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: BertRequest, @Query('tab') tab = 'action') {
    const principal = principalFrom(request)
    const rows = await this.prisma.notification.findMany({ where: {
      recipientId: principal.userId,
      ...(tab === 'action' ? { requiresAction: true } : tab === 'mentions' ? { category: 'MENTION' } : tab === 'today' ? { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } : {}),
    }, orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }], take: 100 })
    return { items: rows, counts: { action: await this.prisma.notification.count({ where: { recipientId: principal.userId, requiresAction: true } }), unread: await this.prisma.notification.count({ where: { recipientId: principal.userId, readAt: null } }) } }
  }

  @Patch(':id')
  async read(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { read: boolean }) {
    const result = await this.prisma.notification.updateMany({ where: { id, recipientId: principalFrom(request).userId }, data: { readAt: body.read ? new Date() : null } })
    if (!result.count) throw notFound()
    return { read: body.read }
  }
}
