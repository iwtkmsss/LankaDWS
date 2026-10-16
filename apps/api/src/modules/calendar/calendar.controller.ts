import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { createCalendarEventSchema, updateCalendarEventSchema } from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { isGlobalAdmin, principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { CalendarService } from './calendar.service.js'
import { calendarOccurrences, readCalendarRecurrence } from './calendar-recurrence.js'
import { readReminderMinutes } from './calendar-reminder.js'

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly calendar: CalendarService,
  ) {}

  @Get('audiences')
  audiences(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.calendar.audiences(principalFrom(request), company)
  }

  @Post('events')
  createEvent(
    @Req() request: LankaDWSRequest,
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
    @Req() request: LankaDWSRequest,
    @Param('id') eventId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateCalendarEventSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('calendar_event_invalid')
    return this.calendar.update(principalFrom(request), eventId, parsed.data)
  }

  @Get('events')
  async events(
    @Req() request: LankaDWSRequest,
    @Query('company') company?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope = 'ALL',
  ) {
    const principal = principalFrom(request)
    if (!['ALL', 'MINE', 'TEAM', 'TASKS'].includes(scope)) throw badRequest('calendar_scope_invalid')
    const rangeFrom = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const rangeTo = to ? new Date(to) : new Date(rangeFrom.getFullYear(), rangeFrom.getMonth() + 1, 1)
    if (!Number.isFinite(rangeFrom.getTime()) || !Number.isFinite(rangeTo.getTime())
      || rangeTo <= rangeFrom || rangeTo.getTime() - rangeFrom.getTime() > 366 * 86_400_000) {
      throw badRequest('calendar_range_invalid')
    }
    const allowedCompanies = this.scope.allowedCompanies(principal, company)
    const rows = await this.prisma.event.findMany({
      where: {
        workspaceId: principal.workspaceId,
        audiences: { some: { companyId: { in: allowedCompanies } } },
        OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
        AND: [{ OR: [
          { startAt: { lt: rangeTo }, endAt: { gte: rangeFrom } },
          { recurrenceJson: { not: null }, startAt: { lt: rangeTo } },
        ] }],
      },
      include: { audiences: { select: { companyId: true } } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    })
    const events = rows.flatMap((event) => calendarOccurrences(event, rangeFrom, rangeTo))
    // Use the same aggregate read boundary as TaskAccessService.
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId: principal.workspaceId,
        archivedAt: null,
        dueAt: { gte: rangeFrom, lt: rangeTo },
        ...(isGlobalAdmin(principal) ? {} : { OR: [
          { createdById: principal.userId }, { reporterId: principal.userId },
          { participants: { some: { userId: principal.userId, removedAt: null } } },
        ] }),
      },
      select: { id: true, companyId: true, title: true, dueAt: true, createdById: true, reporterId: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    })
    const taskItems = tasks.map((task) => ({
      id: task.id, taskId: task.id, occurrenceKey: `task:${task.id}`, kind: 'TASK',
      companyId: task.companyId, title: task.title, description: null,
      startAt: task.dueAt!.toISOString(), endAt: task.dueAt!.toISOString(),
      allDay: false, visibility: 'PRIVATE', ownerId: task.createdById, ownerName: '',
      audienceCompanyIds: task.companyId ? [task.companyId] : [], audienceLabel: '',
      sourceTimezone: 'UTC', version: 1, recurrence: null,
    }))
    const inMyCompany = (event: typeof events[number]) => event.visibility !== 'PRIVATE'
      && principal.primaryCompanyId !== null
      && event.audiences.some((audience) => audience.companyId === principal.primaryCompanyId)
    const ownerIds = [...new Set(events.map((event) => event.ownerId))]
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ownerIds }, workspaceId: principal.workspaceId },
      select: { id: true, displayName: true },
    })
    const ownerById = new Map(owners.map((owner) => [owner.id, owner.displayName]))
    const companyNames = await this.companyNames(principal.workspaceId)
    const filtered = events.filter((event) =>
      scope === 'MINE' ? event.ownerId === principal.userId
        : scope === 'TEAM' ? inMyCompany(event)
          : scope === 'TASKS' ? false
          : true,
    )
    return {
      items: [...filtered.map(({ audiences, recurrenceJson, ...event }) => ({
        kind: 'EVENT',
        recurrence: readCalendarRecurrence(recurrenceJson),
        ...event,
        ownerName: ownerById.get(event.ownerId) ?? 'Недоступний користувач',
        audienceCompanyIds: audiences.map((audience) => audience.companyId),
        audienceLabel: audienceLabel(event.visibility, audiences, companyNames),
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
      })), ...taskItems.filter((task) => scope === 'ALL' || scope === 'TASKS'
        || (scope === 'MINE' && tasks.some((row) => row.id === task.id && (row.createdById === principal.userId || row.reporterId === principal.userId)))
        || (scope === 'TEAM' && task.companyId === principal.primaryCompanyId && principal.primaryCompanyId !== null))]
        .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)),
      counts: {
        ALL: events.length + tasks.length,
        MINE: events.filter((event) => event.ownerId === principal.userId).length + tasks.filter((task) => task.createdById === principal.userId || task.reporterId === principal.userId).length,
        TEAM: events.filter(inMyCompany).length + tasks.filter((task) => principal.primaryCompanyId !== null && task.companyId === principal.primaryCompanyId).length,
        TASKS: tasks.length,
      },
    }
  }

  @Get('events/:id')
  async eventDetail(
    @Req() request: LankaDWSRequest,
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
    const { audiences, recurrenceJson, ...rest } = event
    return {
      ...rest,
      kind: 'EVENT',
      recurrence: readCalendarRecurrence(recurrenceJson),
      reminderMinutes: event.ownerId === principal.userId && event.visibility === 'PRIVATE'
        ? await readReminderMinutes(this.prisma, event.id, event.version) : null,
      ownerName: owner?.displayName ?? 'Недоступний користувач',
      audienceCompanyIds: audiences.map((audience) => audience.companyId),
      audienceLabel: audienceLabel(event.visibility, audiences, companyNames),
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
    }
  }

  @Get('presence')
  async presence(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
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
