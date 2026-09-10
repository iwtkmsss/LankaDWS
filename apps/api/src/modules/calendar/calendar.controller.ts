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

  @Get('audiences')
  audiences(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.calendar.audiences(principalFrom(request), company)
  }

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
    const allowedCompanies = this.scope.allowedCompanies(principal, company)
    const events = await this.prisma.event.findMany({
      where: {
        workspaceId: principal.workspaceId,
        audiences: { some: { companyId: { in: allowedCompanies } } },
        OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
        ...(from && to ? { startAt: { lte: new Date(to) }, endAt: { gte: new Date(from) } } : {}),
      },
      include: { audiences: { select: { companyId: true } } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    })
    const ownerIds = [...new Set(events.map((event) => event.ownerId))]
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ownerIds }, workspaceId: principal.workspaceId },
      select: { id: true, displayName: true },
    })
    const ownerById = new Map(owners.map((owner) => [owner.id, owner.displayName]))
    const companyNames = await this.companyNames(principal.workspaceId)
    const filtered = events.filter((event) =>
      scope === 'MINE' ? event.ownerId === principal.userId
        : scope === 'TEAM' ? event.ownerId !== principal.userId
          : true,
    )
    return {
      items: filtered.map(({ audiences, ...event }) => ({
        ...event,
        ownerName: ownerById.get(event.ownerId) ?? 'Недоступний користувач',
        audienceCompanyIds: audiences.map((audience) => audience.companyId),
        audienceLabel: audienceLabel(event.visibility, audiences, companyNames),
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
        workspaceId: principal.workspaceId,
        audiences: { some: { companyId: { in: this.scope.allowedCompanies(principal, company) } } },
        OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
      },
      include: { audiences: { select: { companyId: true } } },
    })
    if (!event) return null
    const owner = await this.prisma.user.findFirst({
      where: { id: event.ownerId, workspaceId: principal.workspaceId },
      select: { displayName: true },
    })
    const companyNames = await this.companyNames(principal.workspaceId)
    const { audiences, ...rest } = event
    return {
      ...rest,
      ownerName: owner?.displayName ?? 'Недоступний користувач',
      audienceCompanyIds: audiences.map((audience) => audience.companyId),
      audienceLabel: audienceLabel(event.visibility, audiences, companyNames),
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

  private async companyNames(workspaceId: string): Promise<Map<string, string>> {
    const companies = await this.prisma.company.findMany({
      where: { workspaceId },
      select: { id: true, displayName: true },
    })
    return new Map(companies.map((company) => [company.id, company.displayName]))
  }
}

function audienceLabel(
  visibility: string,
  audiences: Array<{ companyId: string }>,
  companyNames: Map<string, string>,
): string {
  if (visibility === 'PRIVATE') return 'Тільки мені'
  const names = audiences
    .map((audience) => companyNames.get(audience.companyId))
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => left.localeCompare(right, 'uk-UA'))
  if (names.length === 0) return 'Без аудиторії'
  return names.join(', ')
}
