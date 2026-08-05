import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { createCalendarEventSchema, updateCalendarEventSchema } from '@bert-crm/contracts'
import { badRequest } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { CalendarService } from './calendar.service.js'

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly calendar: CalendarService,
  ) {}

  @Post('events')
  createEvent(
    @Req() request: BertRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = createCalendarEventSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('calendar_event_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.calendar.create(principalFrom(request), parsed.data, key)
  }

  @Patch('events/:id')
  updateEvent(
    @Req() request: BertRequest,
    @Param('id') eventId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateCalendarEventSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('calendar_event_invalid')
    return this.calendar.update(principalFrom(request), eventId, parsed.data)
  }

  @Get('events')
  async events(
    @Req() request: BertRequest,
    @Query('company') company?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope = 'ALL',
  ) {
    const principal = principalFrom(request)
    if (!['ALL', 'MINE', 'TEAM'].includes(scope)) throw badRequest('calendar_scope_invalid')
    const events = await this.prisma.event.findMany({ where: {
      companyId: { in: this.scope.allowedCompanies(principal, company) },
      OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
      ...(from && to ? { startAt: { lte: new Date(to) }, endAt: { gte: new Date(from) } } : {}),
    }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] })
    const ownerIds = [...new Set(events.map((event) => event.ownerId))]
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ownerIds }, workspaceId: principal.workspaceId },
      select: { id: true, displayName: true },
    })
    const ownerById = new Map(owners.map((owner) => [owner.id, owner.displayName]))
    const filtered = events.filter((event) =>
      scope === 'MINE' ? event.ownerId === principal.userId
        : scope === 'TEAM' ? event.ownerId !== principal.userId
          : true,
    )
    return {
      items: filtered.map((event) => ({
        ...event,
        ownerName: ownerById.get(event.ownerId) ?? 'Недоступний користувач',
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
      })),
      counts: {
        ALL: events.length,
        MINE: events.filter((event) => event.ownerId === principal.userId).length,
        TEAM: events.filter((event) => event.ownerId !== principal.userId).length,
      },
    }
  }

  @Get('events/:id')
  async eventDetail(
    @Req() request: BertRequest,
    @Param('id') eventId: string,
    @Query('company') company?: string,
  ) {
    const principal = principalFrom(request)
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        companyId: { in: this.scope.allowedCompanies(principal, company) },
        OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
      },
    })
    if (!event) return null
    const owner = await this.prisma.user.findFirst({
      where: { id: event.ownerId, workspaceId: principal.workspaceId },
      select: { displayName: true },
    })
    return {
      ...event,
      ownerName: owner?.displayName ?? 'Недоступний користувач',
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
    }
  }

  @Get('presence')
  async presence(@Req() request: BertRequest, @Query('company') company?: string) {
    const principal = principalFrom(request)
    const rows = await this.prisma.presenceRecord.findMany({ where: { companyId: { in: this.scope.allowedCompanies(principal, company) }, endAt: { gte: new Date() } }, orderBy: { startAt: 'asc' } })
    return { items: rows.map(({ state, userId, startAt, endAt }) => ({ userId, state, startAt: startAt.toISOString(), endAt: endAt.toISOString() })) }
  }
}
