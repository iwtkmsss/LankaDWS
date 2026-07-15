import { Controller, Get, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { RequirePermissions } from '../auth/auth.decorators.js'

@Controller('calendar')
@RequirePermissions(Permission.CalendarRead)
export class CalendarController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get('events')
  async events(@Req() request: BertRequest, @Query('company') company?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const principal = principalFrom(request)
    const events = await this.prisma.event.findMany({ where: {
      companyId: { in: this.scope.allowedCompanies(principal, company) },
      OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
      ...(from && to ? { startAt: { lte: new Date(to) }, endAt: { gte: new Date(from) } } : {}),
    }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] })
    return { items: events.map((event) => ({ ...event, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString() })) }
  }

  @Get('presence')
  async presence(@Req() request: BertRequest, @Query('company') company?: string) {
    const principal = principalFrom(request)
    const rows = await this.prisma.presenceRecord.findMany({ where: { companyId: { in: this.scope.allowedCompanies(principal, company) }, endAt: { gte: new Date() } }, orderBy: { startAt: 'asc' } })
    return { items: rows.map(({ state, userId, startAt, endAt }) => ({ userId, state, startAt: startAt.toISOString(), endAt: endAt.toISOString() })) }
  }
}
