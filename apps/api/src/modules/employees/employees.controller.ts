import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { userSelectorSearchSchema, type UserSelectorSearchQuery } from '@lankadws/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { parseUserSearchExcludedIds, searchUsers, userSearchPredicate } from '../../common/search-users.js'

const DIRECTORY_PAGE_SIZE = 20

/** A person's current department: an active primary assignment in an active unit of their own company. */
const currentAssignment = (companyId: string, orgUnit: Prisma.OrgUnitWhereInput = {}): Prisma.UserOrgAssignmentWhereInput => ({
  companyId, endedAt: null, isPrimary: true, orgUnit: { ...orgUnit, status: 'ACTIVE', companyId },
})

/** Unit members: assigned people and the unit's manager (docs/decisions.md 2026-11-04). */
const orgUnitMemberWhere = (companyIds: string[], orgUnitId: string): Prisma.UserWhereInput => ({
  OR: companyIds.map((companyId) => ({ primaryCompanyId: companyId, OR: [
    { orgAssignments: { some: { ...currentAssignment(companyId), orgUnitId } } },
    { managedOrgUnits: { some: { id: orgUnitId, companyId, status: 'ACTIVE' as const } } },
  ] })),
})

/** The row's manager is the current unit's manager, otherwise the personal approver. */
const managerWhere = (companyIds: string[], managerId: string): Prisma.UserWhereInput => ({
  OR: companyIds.map((companyId) => ({ primaryCompanyId: companyId, OR: [
    { orgAssignments: { some: currentAssignment(companyId, { managerId }) } },
    { approverId: managerId, orgAssignments: { none: currentAssignment(companyId, { managerId: { not: null } }) } },
  ] })),
})

@Controller('employees')
export class EmployeesController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Post('search')
  @HttpCode(200)
  async search(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    const principal = principalFrom(request)
    const parsed = userSelectorSearchSchema.safeParse(body)
    if (!parsed.success) throw badRequest('employee_filter_invalid')
    return this.searchOptions(principal, this.scope.allowedCompanies(principal, parsed.data.company), parsed.data)
  }

  private async searchOptions(principal: AuthPrincipal, companyIds: string[], query: UserSelectorSearchQuery) {
    return { items: await searchUsers(this.prisma, principal, query.q, {
      excludeIds: query.excludeIds, limit: query.limit, recommendations: query.recommendations,
      where: { AND: [{ OR: [
        { accountType: 'USER', primaryCompanyId: { in: companyIds } },
        ...(query.accountType !== 'USER' ? [{ accountType: 'ADMIN' as const }] : []),
      ] }, ...(query.managersOnly ? [{ OR: [
        { managedOrgUnits: { some: { companyId: { in: companyIds }, status: 'ACTIVE' as const,
          assignments: { some: { endedAt: null, user: { isActive: true, accountType: 'USER' as const } } } } } },
        { approverFor: { some: { isActive: true, accountType: 'USER' as const, primaryCompanyId: { in: companyIds } } } },
      ] }] : []), ...(query.excludeOrgUnitId ? [{ orgAssignments: { none: { orgUnitId: query.excludeOrgUnitId, endedAt: null } } }] : [])] },
    }) }
  }

  @Get()
  async list(
    @Req() request: LankaDWSRequest,
    @Query('company') company?: string,
    @Query('search') search?: string,
    @Query('orgUnit') orgUnitId?: string,
    @Query('manager') managerId?: string,
    @Query('presence') presenceFilter?: string,
    @Query('limit') limit?: string,
    @Query('accountType') accountType?: string,
    @Query('exclude') exclude?: string,
    @Query('managersOnly') managersOnly?: string,
    @Query('excludeOrgUnitId') excludeOrgUnitId?: string,
    @Query('cursor') cursor?: string,
  ) {
    const principal = principalFrom(request)
    if (presenceFilter && !['AVAILABLE', 'AWAY'].includes(presenceFilter)) {
      throw badRequest('employee_filter_invalid')
    }
    const companyIds = this.scope.allowedCompanies(principal, company)
    // Bounded selector search; the paginated directory below has a separate UI contract.
    if (limit !== undefined) {
      if (managersOnly && managersOnly !== 'true') throw badRequest('employee_filter_invalid')
      const parsed = userSelectorSearchSchema.safeParse({ q: search ?? '', limit, company, accountType,
        excludeIds: parseUserSearchExcludedIds(exclude), managersOnly: managersOnly === 'true', excludeOrgUnitId })
      if (!parsed.success) throw badRequest('employee_filter_invalid')
      return this.searchOptions(principal, companyIds, parsed.data)
    }
    if (cursor && cursor.length > 120) throw badRequest('employee_filter_invalid')
    const inScope = {
      workspaceId: principal.workspaceId,
      isActive: true,
      accountType: 'USER' as const,
      primaryCompanyId: { in: companyIds },
      ...(search?.trim() ? userSearchPredicate(search, { includeJobTitle: true }) : {}),
    }
    // PresenceRecord has no relation to User, so presence filters use the ids of
    // people away right now. This set follows who is away, not directory size.
    const now = new Date()
    const activePresence = await this.prisma.presenceRecord.findMany({
      where: { companyId: { in: companyIds }, startAt: { lte: now }, endAt: { gte: now } },
      select: { userId: true, state: true },
      orderBy: { startAt: 'desc' },
    })
    const state = new Map<string, string>()
    for (const item of activePresence) {
      if (!state.has(item.userId)) state.set(item.userId, item.state)
    }
    const awayIds = [...state].filter(([, value]) => value !== 'AVAILABLE').map(([userId]) => userId)
    const where: Prisma.UserWhereInput = { ...inScope, AND: [
      ...(orgUnitId ? [orgUnitMemberWhere(companyIds, orgUnitId)] : []),
      ...(managerId ? [managerWhere(companyIds, managerId)] : []),
      ...(presenceFilter ? [{ id: presenceFilter === 'AVAILABLE' ? { notIn: awayIds } : { in: awayIds } }] : []),
    ] }
    const [users, total, all, away, orgUnits, managers] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          displayName: true,
          jobTitle: true,
          primaryCompanyId: true,
          timezone: true,
          avatarAsset: true,
          approver: { select: { id: true, displayName: true } },
          orgAssignments: {
            where: {
              companyId: { in: companyIds },
              endedAt: null,
              isPrimary: true,
              orgUnit: { status: 'ACTIVE' },
            },
            select: {
              isPrimary: true,
              positionTitle: true,
              orgUnit: {
                select: {
                  id: true,
                  name: true,
                  companyId: true,
                  parent: { select: { id: true, name: true } },
                  manager: { select: { id: true, displayName: true } },
                },
              },
            },
            orderBy: [{ isPrimary: 'desc' }, { startedAt: 'asc' }],
          },
          managedOrgUnits: {
            where: { companyId: { in: companyIds }, status: 'ACTIVE' },
            select: { id: true, name: true, companyId: true, parent: { select: { id: true, name: true } } },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: DIRECTORY_PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: inScope }),
      this.prisma.user.count({ where: { ...inScope, AND: [{ id: { in: awayIds } }] } }),
      this.prisma.orgUnit.findMany({
        where: { workspaceId: principal.workspaceId, status: 'ACTIVE', OR: companyIds.map((companyId) => ({ companyId, OR: [
          { assignments: { some: { companyId, endedAt: null, isPrimary: true, user: { ...inScope, primaryCompanyId: companyId } } } },
          { manager: { ...inScope, primaryCompanyId: companyId } },
        ] })) },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { workspaceId: principal.workspaceId, OR: [
          { managedOrgUnits: { some: { status: 'ACTIVE', OR: companyIds.map((companyId) => ({ companyId,
            assignments: { some: { companyId, endedAt: null, isPrimary: true, user: { ...inScope, primaryCompanyId: companyId } } } })) } } },
          { approverFor: { some: { OR: companyIds.map((companyId) => ({ ...inScope, primaryCompanyId: companyId,
            orgAssignments: { none: currentAssignment(companyId, { managerId: { not: null } }) } })) } } },
        ] },
        select: { id: true, displayName: true },
      }),
    ])
    const items = users.slice(0, DIRECTORY_PAGE_SIZE).map(({ orgAssignments, approver, managedOrgUnits, ...user }) => {
      const assignment = orgAssignments.find((item) => item.orgUnit.companyId === user.primaryCompanyId)
      const managedUnits = managedOrgUnits.filter((item) => item.companyId === user.primaryCompanyId)
      // In a unit's own list, show that unit for the person who manages it. Otherwise
      // a person with no assignment shows their first managed unit (docs/decisions.md 2026-11-04).
      const managedHere = orgUnitId ? managedUnits.find((item) => item.id === orgUnitId) : undefined
      const unit = managedHere ?? assignment?.orgUnit ?? managedUnits[0]
      return {
        ...user,
        presence: state.get(user.id) ?? 'AVAILABLE',
        positionTitle: assignment?.positionTitle ?? user.jobTitle,
        orgUnit: unit ? { id: unit.id, name: unit.name, parent: unit.parent } : null,
        manager: assignment?.orgUnit.manager ?? approver,
      }
    })
    return {
      items,
      total,
      nextCursor: users.length > DIRECTORY_PAGE_SIZE ? items.at(-1)!.id : null,
      counts: { all, available: all - away, away },
      filters: {
        orgUnits: orgUnits.sort((a, b) => a.name.localeCompare(b.name, 'uk')),
        managers: managers.sort((a, b) => a.displayName.localeCompare(b.displayName, 'uk')),
      },
    }
  }

  @Get(':id')
  async detail(@Req() request: LankaDWSRequest, @Param('id') employeeId: string, @Query('company') company?: string) {
    const principal = principalFrom(request)
    const companyIds = this.scope.allowedCompanies(principal, company)
    const includeOrg = true
    const user = await this.prisma.user.findFirst({
      where: {
        id: employeeId,
        workspaceId: principal.workspaceId,
        isActive: true,
        OR: [
          { accountType: 'USER', primaryCompanyId: { in: companyIds } },
          { accountType: 'ADMIN' },
        ],
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        accountType: true,
        jobTitle: true,
        primaryCompanyId: true,
        primaryCompany: { select: { id: true, displayName: true } },
        avatarAsset: true,
        approverId: true,
        contactEmail: true,
        phone: true,
        orgAssignments: {
          where: { companyId: { in: companyIds }, endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } },
          select: {
            positionTitle: true,
            orgUnit: { select: { id: true, name: true, companyId: true, parent: { select: { id: true, name: true } }, manager: { select: { id: true, displayName: true } } } },
          },
          orderBy: [{ isPrimary: 'desc' }, { startedAt: 'asc' }],
        },
        managedOrgUnits: {
          where: { companyId: { in: companyIds }, status: 'ACTIVE' },
          select: { id: true, name: true, companyId: true, parent: { select: { id: true, name: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    })
    if (!user) throw notFound()
    const [approver, upcomingPresence] = await Promise.all([
      user.approverId ? this.prisma.user.findUnique({ where: { id: user.approverId }, select: { id: true, displayName: true } }) : null,
      this.prisma.presenceRecord.findMany({
        where: { userId: user.id, companyId: { in: companyIds }, endAt: { gte: new Date() } },
        select: { state: true, startAt: true, endAt: true },
        orderBy: { startAt: 'asc' },
        take: 3,
      }),
    ])
    const { orgAssignments, managedOrgUnits, ...safeUser } = user
    const assignment = includeOrg ? orgAssignments.find((item) => item.orgUnit.companyId === user.primaryCompanyId) : undefined
    const unit = assignment?.orgUnit ?? managedOrgUnits.find((item) => item.companyId === user.primaryCompanyId)
    return {
      ...safeUser,
      positionTitle: assignment?.positionTitle ?? user.jobTitle,
      orgUnit: unit ? { id: unit.id, name: unit.name, parent: unit.parent } : null,
      approver: assignment?.orgUnit.manager ?? approver,
      upcomingPresence: upcomingPresence.map((row) => ({
        state: row.state,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
      })),
    }
  }
}
