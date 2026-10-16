import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { userSelectorSearchSchema, type UserSelectorSearchQuery } from '@lankadws/contracts'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { parseUserSearchExcludedIds, searchUsers, userSearchPredicate } from '../../common/search-users.js'

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
      excludeIds: query.excludeIds, limit: query.limit,
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
  ) {
    const principal = principalFrom(request)
    const includeOrg = true
    if (orgUnitId && !includeOrg) throw badRequest('employee_filter_invalid')
    if (presenceFilter && !['AVAILABLE', 'AWAY'].includes(presenceFilter)) {
      throw badRequest('employee_filter_invalid')
    }
    const companyIds = this.scope.allowedCompanies(principal, company)
    // Bounded selector search; the full directory below has a separate UI contract.
    if (limit !== undefined) {
      if (managersOnly && managersOnly !== 'true') throw badRequest('employee_filter_invalid')
      const parsed = userSelectorSearchSchema.safeParse({ q: search ?? '', limit, company, accountType,
        excludeIds: parseUserSearchExcludedIds(exclude), managersOnly: managersOnly === 'true', excludeOrgUnitId })
      if (!parsed.success) throw badRequest('employee_filter_invalid')
      return this.searchOptions(principal, companyIds, parsed.data)
    }
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId: principal.workspaceId,
        isActive: true,
        accountType: 'USER',
        primaryCompanyId: { in: companyIds },
        ...(search?.trim() ? userSearchPredicate(search, { includeJobTitle: true }) : {}),
      },
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
      },
      orderBy: { displayName: 'asc' },
    })
    const now = new Date()
    const activePresence = await this.prisma.presenceRecord.findMany({
      where: {
        userId: { in: users.map((user) => user.id) },
        companyId: { in: companyIds },
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { userId: true, state: true },
      orderBy: { startAt: 'desc' },
    })
    const state = new Map<string, string>()
    for (const item of activePresence) {
      if (!state.has(item.userId)) state.set(item.userId, item.state)
    }
    const directory = users.map(({ orgAssignments, approver, ...user }) => {
      const assignment = includeOrg ? orgAssignments.find((item) => item.orgUnit.companyId === user.primaryCompanyId) : undefined
      const manager = assignment?.orgUnit.manager ?? approver
      return {
        ...user,
        presence: state.get(user.id) ?? 'AVAILABLE',
        positionTitle: assignment?.positionTitle ?? user.jobTitle,
        orgUnit: assignment ? { id: assignment.orgUnit.id, name: assignment.orgUnit.name, parent: assignment.orgUnit.parent } : null,
        manager,
      }
    })
    const rows = directory.filter((user) =>
      (!orgUnitId || user.orgUnit?.id === orgUnitId)
      && (!managerId || user.manager?.id === managerId)
      && (!presenceFilter || (presenceFilter === 'AVAILABLE' ? user.presence === 'AVAILABLE' : user.presence !== 'AVAILABLE')),
    )
    const orgUnits = new Map<string, string>()
    const managers = new Map<string, string>()
    for (const user of directory) {
      if (user.orgUnit) orgUnits.set(user.orgUnit.id, user.orgUnit.name)
      if (user.manager) managers.set(user.manager.id, user.manager.displayName)
    }
    return {
      items: rows,
      counts: {
        all: directory.length,
        available: directory.filter((user) => user.presence === 'AVAILABLE').length,
        away: directory.filter((user) => user.presence !== 'AVAILABLE').length,
      },
      filters: {
        orgUnits: [...orgUnits].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
        managers: [...managers].map(([id, displayName]) => ({ id, displayName })).sort((a, b) => a.displayName.localeCompare(b.displayName, 'uk')),
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
    const { orgAssignments, ...safeUser } = user
    const assignment = includeOrg ? orgAssignments.find((item) => item.orgUnit.companyId === user.primaryCompanyId) : undefined
    return {
      ...safeUser,
      positionTitle: assignment?.positionTitle ?? user.jobTitle,
      orgUnit: assignment ? { id: assignment.orgUnit.id, name: assignment.orgUnit.name, parent: assignment.orgUnit.parent } : null,
      approver: assignment?.orgUnit.manager ?? approver,
      upcomingPresence: upcomingPresence.map((row) => ({
        state: row.state,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
      })),
    }
  }
}
