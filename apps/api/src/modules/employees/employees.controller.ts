import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { RequirePermissions } from '../auth/auth.decorators.js'

@Controller('employees')
@RequirePermissions(Permission.EmployeesRead)
export class EmployeesController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async list(
    @Req() request: BertRequest,
    @Query('company') company?: string,
    @Query('search') search?: string,
    @Query('orgUnit') orgUnitId?: string,
    @Query('manager') managerId?: string,
    @Query('presence') presenceFilter?: string,
  ) {
    const principal = principalFrom(request)
    const includeOrg = principal.permissions.has(Permission.EmployeesOrgRead)
    if (orgUnitId && !includeOrg) throw badRequest('employee_filter_invalid')
    if (presenceFilter && !['AVAILABLE', 'AWAY'].includes(presenceFilter)) {
      throw badRequest('employee_filter_invalid')
    }
    const companyIds = this.scope.allowedCompanies(principal, company)
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        companyAccess: { some: { companyId: { in: companyIds }, status: 'ACTIVE' } },
        ...(search
          ? { OR: [{ displayName: { contains: search } }, { jobTitle: { contains: search } }, { username: { contains: search } }] }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        displayRole: true,
        jobTitle: true,
        primaryCompanyId: true,
        timezone: true,
        avatarAsset: true,
        approver: { select: { id: true, displayName: true } },
        orgAssignments: {
          where: {
            companyId: { in: companyIds },
            endedAt: null,
            orgUnit: { status: 'ACTIVE' },
          },
          select: {
            isPrimary: true,
            positionTitle: true,
            orgUnit: {
              select: {
                id: true,
                name: true,
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
      const assignment = includeOrg ? orgAssignments[0] : undefined
      const manager = assignment?.orgUnit.manager ?? approver
      return {
        ...user,
        presence: state.get(user.id) ?? 'AVAILABLE',
        positionTitle: assignment?.positionTitle ?? user.jobTitle,
        orgUnit: assignment ? { id: assignment.orgUnit.id, name: assignment.orgUnit.name } : null,
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
  async detail(@Req() request: BertRequest, @Param('id') employeeId: string, @Query('company') company?: string) {
    const principal = principalFrom(request)
    const companyIds = this.scope.allowedCompanies(principal, company)
    const includeOrg = principal.permissions.has(Permission.EmployeesOrgRead)
    const user = await this.prisma.user.findFirst({
      where: {
        id: employeeId,
        status: 'ACTIVE',
        companyAccess: { some: { companyId: { in: companyIds }, status: 'ACTIVE' } },
      },
      select: {
        id: true,
        displayName: true,
        displayRole: true,
        jobTitle: true,
        primaryCompanyId: true,
        timezone: true,
        locale: true,
        avatarAsset: true,
        approverId: true,
        contactEmail: true,
        orgAssignments: {
          where: { companyId: { in: companyIds }, endedAt: null, orgUnit: { status: 'ACTIVE' } },
          select: {
            positionTitle: true,
            orgUnit: { select: { id: true, name: true, manager: { select: { id: true, displayName: true } } } },
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
    const assignment = includeOrg ? orgAssignments[0] : undefined
    return {
      ...safeUser,
      positionTitle: assignment?.positionTitle ?? user.jobTitle,
      orgUnit: assignment ? { id: assignment.orgUnit.id, name: assignment.orgUnit.name } : null,
      approver: assignment?.orgUnit.manager ?? approver,
      upcomingPresence: upcomingPresence.map((row) => ({
        state: row.state,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
      })),
    }
  }
}
