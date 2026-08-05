import { Injectable } from '@nestjs/common'
import type { OrgUnitEmployeeView, OrgUnitListQuery, OrgUnitView } from '@bert-crm/contracts'
import { notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async listUnits(principal: AuthPrincipal, query: OrgUnitListQuery): Promise<{ items: OrgUnitView[] }> {
    const companyId = this.scope.assertCompany(principal, query.company)
    const units = await this.prisma.orgUnit.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId,
        status: 'ACTIVE',
        ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
        ...(query.query
          ? { OR: [{ name: { contains: query.query } }, { normalizedName: { contains: query.query.toLowerCase() } }] }
          : {}),
      },
      select: {
        id: true,
        companyId: true,
        parentId: true,
        name: true,
        sortOrder: true,
        version: true,
        manager: { select: { id: true, displayName: true, jobTitle: true } },
        _count: {
          select: {
            children: { where: { status: 'ACTIVE' } },
            assignments: { where: { endedAt: null, user: { isActive: true } } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    })
    return {
      items: units.map((unit) => ({
        id: unit.id,
        companyId: unit.companyId,
        parentId: unit.parentId,
        name: unit.name,
        manager: unit.manager,
        activeEmployeeCount: unit._count.assignments,
        childCount: unit._count.children,
        sortOrder: unit.sortOrder,
        version: unit.version,
      })),
    }
  }

  async listEmployees(principal: AuthPrincipal, unitId: string, company?: string): Promise<{ items: OrgUnitEmployeeView[] }> {
    const companyIds = company
      ? [this.scope.assertCompany(principal, company)]
      : principal.allowedCompanyIds
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id: unitId, workspaceId: principal.workspaceId, companyId: { in: companyIds }, status: 'ACTIVE' },
      select: { id: true, companyId: true },
    })
    if (!unit) throw notFound()
    const assignments = await this.prisma.userOrgAssignment.findMany({
      where: { orgUnitId: unit.id, companyId: unit.companyId, endedAt: null, user: { isActive: true } },
      select: {
        isPrimary: true,
        positionTitle: true,
        user: { select: { id: true, displayName: true, jobTitle: true, avatarAsset: true } },
      },
      orderBy: { user: { displayName: 'asc' } },
    })
    return {
      items: assignments.map((assignment) => ({
        ...assignment.user,
        positionTitle: assignment.positionTitle,
        isPrimary: assignment.isPrimary,
      })),
    }
  }
}
