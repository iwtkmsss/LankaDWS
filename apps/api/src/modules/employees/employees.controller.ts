import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { RequirePermissions } from '../auth/auth.decorators.js'

@Controller('employees')
@RequirePermissions(Permission.EmployeesRead)
export class EmployeesController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async list(@Req() request: BertRequest, @Query('company') company?: string, @Query('search') search?: string) {
    const principal = principalFrom(request)
    const users = await this.prisma.user.findMany({ where: {
      status: 'ACTIVE',
      companyAccess: { some: { companyId: { in: this.scope.allowedCompanies(principal, company) }, status: 'ACTIVE' } },
      ...(search ? { OR: [{ displayName: { contains: search } }, { jobTitle: { contains: search } }, { username: { contains: search } }] } : {}),
    }, select: { id: true, displayName: true, displayRole: true, jobTitle: true, primaryCompanyId: true, timezone: true, avatarAsset: true }, orderBy: { displayName: 'asc' } })
    const presence = await this.prisma.presenceRecord.findMany({ where: { userId: { in: users.map((user) => user.id) }, startAt: { lte: new Date() }, endAt: { gte: new Date() } }, select: { userId: true, state: true } })
    const state = new Map(presence.map((item) => [item.userId, item.state]))
    return { items: users.map((user) => ({ ...user, presence: state.get(user.id) ?? 'AVAILABLE' })) }
  }

  @Get(':id')
  async detail(@Req() request: BertRequest, @Param('id') employeeId: string) {
    const principal = principalFrom(request)
    const user = await this.prisma.user.findFirst({ where: { id: employeeId, status: 'ACTIVE', companyAccess: { some: { companyId: { in: principal.allowedCompanyIds }, status: 'ACTIVE' } } }, select: { id: true, displayName: true, displayRole: true, jobTitle: true, primaryCompanyId: true, timezone: true, locale: true, avatarAsset: true, approverId: true, contactEmail: true } })
    if (!user) throw notFound()
    const [approver, upcomingPresence] = await Promise.all([
      user.approverId ? this.prisma.user.findUnique({ where: { id: user.approverId }, select: { id: true, displayName: true } }) : null,
      this.prisma.presenceRecord.findMany({ where: { userId: user.id, endAt: { gte: new Date() } }, select: { state: true, startAt: true, endAt: true }, orderBy: { startAt: 'asc' }, take: 3 }),
    ])
    return { ...user, approver, upcomingPresence: upcomingPresence.map((row) => ({ state: row.state, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() })) }
  }
}
