import { Injectable } from '@nestjs/common'
import type {
  AdminOrgUnitListQuery, AdminOrgUnitView, ArchiveOrgUnitInput, AssignOrgUnitEmployeesInput, CreateOrgUnitInput,
  OrgCompanyView, OrgUnitEmployeeView, OrgUnitListQuery, OrgUnitView,
  RestoreOrgUnitInput, UpdateOrgUnitInput,
} from '@bert-crm/contracts'
import { conflict, notFound } from '../../common/errors.js'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

type ManagerRow = { id: string; displayName: string; jobTitle: string; isActive: boolean; primaryCompanyId: string | null }
const normalizeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
const normalizedName = (value: string) => normalizeName(value).toLocaleLowerCase('uk')

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  private async uniqueNameGuard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw conflict('Підрозділ із такою назвою вже існує на цьому рівні.')
      }
      throw error
    }
  }

  private managerView(manager: ManagerRow | null, companyId: string) {
    if (!manager?.isActive || manager.primaryCompanyId !== companyId) return null
    return { id: manager.id, displayName: manager.displayName, jobTitle: manager.jobTitle }
  }

  private async company(principal: AuthPrincipal, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, workspaceId: principal.workspaceId },
      select: {
        id: true, displayName: true, version: true,
        manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } },
      },
    })
    if (!company) throw notFound()
    return company
  }

  private async manager(principal: AuthPrincipal, companyId: string, managerId: string) {
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, workspaceId: principal.workspaceId, primaryCompanyId: companyId, accountType: 'USER', isActive: true },
      select: { id: true },
    })
    if (!manager) throw notFound()
  }

  private async activeParent(principal: AuthPrincipal, companyId: string, parentId: string) {
    const parent = await this.prisma.orgUnit.findFirst({
      where: { id: parentId, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE' }, select: { id: true },
    })
    if (!parent) throw notFound()
    return parent
  }

  private async assertUniqueName(companyId: string, parentId: string | null, name: string, excludeId?: string) {
    const duplicate = await this.prisma.orgUnit.findFirst({
      where: { companyId, parentId, normalizedName: normalizedName(name), status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (duplicate) throw conflict('Підрозділ із такою назвою вже існує на цьому рівні.')
  }

  private async allUnits(companyId: string) {
    return this.prisma.orgUnit.findMany({ where: { companyId }, select: { id: true, parentId: true } })
  }

  private descendantIds(unitId: string, units: Array<{ id: string; parentId: string | null }>) {
    const result = new Set<string>()
    const pending = [unitId]
    while (pending.length) {
      const parentId = pending.pop()!
      for (const unit of units) {
        if (unit.parentId !== parentId || result.has(unit.id)) continue
        result.add(unit.id)
        pending.push(unit.id)
      }
    }
    return result
  }

  private async nextSortOrder(companyId: string, parentId: string | null) {
    const last = await this.prisma.orgUnit.findFirst({
      where: { companyId, parentId, status: 'ACTIVE' }, orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }], select: { sortOrder: true },
    })
    return (last?.sortOrder ?? 0) + 10
  }

  private unitSelect(companyId: string) {
    return {
      id: true, companyId: true, parentId: true, name: true, status: true, sortOrder: true, version: true,
      manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } },
      _count: { select: {
        children: { where: { status: 'ACTIVE' as const } },
        assignments: { where: { endedAt: null, isPrimary: true, user: { isActive: true, accountType: 'USER' as const, primaryCompanyId: companyId } } },
      } },
    }
  }

  private unitView(unit: {
    id: string; companyId: string; parentId: string | null; name: string; manager: ManagerRow | null
    status: 'ACTIVE' | 'ARCHIVED' | 'INACTIVE'; sortOrder: number; version: number
    _count: { children: number; assignments: number }
  }): OrgUnitView {
    return {
      id: unit.id, companyId: unit.companyId, parentId: unit.parentId, name: unit.name,
      manager: this.managerView(unit.manager, unit.companyId), activeEmployeeCount: unit._count.assignments,
      childCount: unit._count.children, sortOrder: unit.sortOrder, version: unit.version,
    }
  }

  async listUnits(principal: AuthPrincipal, query: OrgUnitListQuery): Promise<{ company: OrgCompanyView; items: OrgUnitView[] }> {
    const companyId = this.scope.assertCompany(principal, query.company)
    const company = await this.company(principal, companyId)
    const units = await this.prisma.orgUnit.findMany({
      where: {
        workspaceId: principal.workspaceId, companyId, status: 'ACTIVE',
        ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
        ...(query.query ? { OR: [{ name: { contains: query.query } }, { normalizedName: { contains: query.query.toLocaleLowerCase('uk') } }] } : {}),
      },
      select: this.unitSelect(companyId), orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    })
    return {
      company: { id: company.id, name: company.displayName, manager: this.managerView(company.manager, company.id), version: company.version },
      items: units.map((unit) => this.unitView(unit)),
    }
  }

  async listAdminUnits(principal: AuthPrincipal, companyId: string, query: AdminOrgUnitListQuery): Promise<{ company: OrgCompanyView; items: AdminOrgUnitView[] }> {
    const company = await this.company(principal, companyId)
    const units = await this.prisma.orgUnit.findMany({
      where: {
        workspaceId: principal.workspaceId, companyId,
        ...(query.status === 'ALL' ? { status: { in: ['ACTIVE', 'ARCHIVED'] as const } } : { status: query.status }),
      },
      select: this.unitSelect(companyId), orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    })
    return {
      company: { id: company.id, name: company.displayName, manager: this.managerView(company.manager, company.id), version: company.version },
      items: units.map((unit) => ({ ...this.unitView(unit), status: unit.status as 'ACTIVE' | 'ARCHIVED' })),
    }
  }

  async createUnit(principal: AuthPrincipal, companyId: string, input: CreateOrgUnitInput) {
    await this.company(principal, companyId)
    const parentId = input.parentId ?? null
    if (parentId) await this.activeParent(principal, companyId, parentId)
    if (input.managerId) await this.manager(principal, companyId, input.managerId)
    await this.assertUniqueName(companyId, parentId, input.name)
    const unitId = id('org')
    const sortOrder = await this.nextSortOrder(companyId, parentId)
    const unit = await this.uniqueNameGuard(() => this.prisma.$transaction(async (tx) => {
      const created = await tx.orgUnit.create({ data: {
        id: unitId, workspaceId: principal.workspaceId, companyId, parentId, name: normalizeName(input.name),
        normalizedName: normalizedName(input.name), managerId: input.managerId ?? null, sortOrder,
      } })
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'org_unit.created', entityType: 'ORG_UNIT', entityId: unitId, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ parentId, managerId: input.managerId ?? null }), correlationId: id('corr'),
      } })
      return created
    }))
    return { id: unit.id, version: unit.version }
  }

  async updateUnit(principal: AuthPrincipal, companyId: string, unitId: string, input: UpdateOrgUnitInput) {
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: unitId, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE' } })
    if (!unit) throw notFound()
    if (unit.version !== input.expectedVersion) throw conflict('Підрозділ уже змінено іншим адміністратором.')
    const nextName = input.name ?? unit.name
    const nextParentId = input.parentId !== undefined ? input.parentId : unit.parentId
    if (nextParentId === unit.id) throw conflict('Підрозділ не може бути батьком самого себе.')
    if (input.parentId !== undefined && nextParentId) {
      await this.activeParent(principal, companyId, nextParentId)
      if (this.descendantIds(unit.id, await this.allUnits(companyId)).has(nextParentId)) throw conflict('Не можна перемістити підрозділ у його дочірню гілку.')
    }
    if (input.managerId) await this.manager(principal, companyId, input.managerId)
    await this.assertUniqueName(companyId, nextParentId, nextName, unit.id)
    const parentChanged = nextParentId !== unit.parentId
    const sortOrder = parentChanged ? await this.nextSortOrder(companyId, nextParentId) : unit.sortOrder
    await this.uniqueNameGuard(() => this.prisma.$transaction(async (tx) => {
      const updated = await tx.orgUnit.updateMany({
        where: { id: unit.id, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE', version: input.expectedVersion },
        data: {
          name: normalizeName(nextName), normalizedName: normalizedName(nextName), parentId: nextParentId, sortOrder,
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}), version: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw conflict('Підрозділ уже змінено іншим адміністратором.')
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'org_unit.updated', entityType: 'ORG_UNIT', entityId: unit.id, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ name: normalizeName(nextName), parentId: nextParentId, managerId: input.managerId }), correlationId: id('corr'),
      } })
    }))
    return { id: unit.id, version: input.expectedVersion + 1 }
  }

  async assignEmployees(principal: AuthPrincipal, companyId: string, unitId: string, input: AssignOrgUnitEmployeesInput) {
    const [unit, employees, assignments] = await Promise.all([
      this.prisma.orgUnit.findFirst({ where: { id: unitId, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE' }, select: { id: true, version: true } }),
      this.prisma.user.findMany({ where: { id: { in: input.employeeIds }, workspaceId: principal.workspaceId, primaryCompanyId: companyId, accountType: 'USER', isActive: true }, select: { id: true } }),
      this.prisma.userOrgAssignment.findMany({ where: { userId: { in: input.employeeIds }, endedAt: null, isPrimary: true }, select: { userId: true, orgUnitId: true, positionTitle: true } }),
    ])
    if (!unit || employees.length !== input.employeeIds.length) throw notFound()
    if (unit.version !== input.expectedVersion) throw conflict('Підрозділ уже змінено іншим адміністратором.')
    const employeeIds = new Set(employees.map((employee) => employee.id))
    const moved = assignments.filter((assignment) => employeeIds.has(assignment.userId) && assignment.orgUnitId !== unit.id)
    const assignedIds = new Set(assignments.map((assignment) => assignment.userId))
    for (const employeeId of employeeIds) {
      if (!assignedIds.has(employeeId)) moved.push({ userId: employeeId, orgUnitId: '', positionTitle: null })
    }
    if (!moved.length) return { id: unit.id, version: unit.version, moved: 0 }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.orgUnit.updateMany({
        where: { id: unit.id, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE', version: input.expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (updated.count !== 1) throw conflict('Підрозділ уже змінено іншим адміністратором.')
      for (const assignment of moved) {
        await tx.userOrgAssignment.updateMany({ where: { userId: assignment.userId, endedAt: null, isPrimary: true }, data: { endedAt: now, isPrimary: false } })
        await tx.userOrgAssignment.create({ data: {
          id: id('uoa'), companyId, userId: assignment.userId, orgUnitId: unit.id,
          isPrimary: true, positionTitle: assignment.positionTitle, startedAt: now,
        } })
      }
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'org_unit.employees_assigned', entityType: 'ORG_UNIT', entityId: unit.id, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ employeesMoved: moved.length }), correlationId: id('corr'),
      } })
    })
    return { id: unit.id, version: unit.version + 1, moved: moved.length }
  }

  async archiveUnit(principal: AuthPrincipal, companyId: string, unitId: string, input: ArchiveOrgUnitInput) {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id: unitId, workspaceId: principal.workspaceId, companyId, status: 'ACTIVE' },
      include: {
        children: { where: { status: 'ACTIVE' }, select: { id: true, name: true, normalizedName: true, sortOrder: true } },
        assignments: { where: { endedAt: null, isPrimary: true, user: { accountType: 'USER', primaryCompanyId: companyId } }, select: { userId: true, positionTitle: true } },
      },
    })
    if (!unit) throw notFound()
    if (unit.version !== input.expectedVersion) throw conflict('Підрозділ уже змінено іншим адміністратором.')
    const destinationId = unit.parentId ?? input.targetUnitId
    if (!destinationId) throw conflict('Для відділу верхнього рівня потрібно обрати цільовий підрозділ.')
    const destination = await this.activeParent(principal, companyId, destinationId)
    const descendants = this.descendantIds(unit.id, await this.allUnits(companyId))
    if (destination.id === unit.id || descendants.has(destination.id)) throw conflict('Ціль не може бути частиною архівованої гілки.')
    const destinationChildren = await this.prisma.orgUnit.findMany({
      where: { companyId, parentId: destination.id, status: 'ACTIVE', id: { not: unit.id } }, select: { normalizedName: true },
    })
    const existingNames = new Set(destinationChildren.map((item) => item.normalizedName))
    const nameConflicts = unit.children.filter((child) => existingNames.has(child.normalizedName)).map((child) => child.name)
    if (nameConflicts.length) throw conflict(`Конфлікт назв після перенесення: ${nameConflicts.join(', ')}`)
    const firstMovedSortOrder = await this.nextSortOrder(companyId, destination.id)
    const now = new Date()
    await this.uniqueNameGuard(() => this.prisma.$transaction(async (tx) => {
      for (const [index, child] of [...unit.children].sort((left, right) => left.sortOrder - right.sortOrder).entries()) {
        await tx.orgUnit.updateMany({
          where: { id: child.id, companyId, status: 'ACTIVE' },
          data: { parentId: destination.id, sortOrder: firstMovedSortOrder + index * 10, version: { increment: 1 } },
        })
      }
      for (const assignment of unit.assignments) {
        await tx.userOrgAssignment.updateMany({ where: { userId: assignment.userId, endedAt: null, isPrimary: true }, data: { endedAt: now, isPrimary: false } })
        await tx.userOrgAssignment.create({ data: {
          id: id('uoa'), companyId, userId: assignment.userId, orgUnitId: destination.id,
          isPrimary: true, positionTitle: assignment.positionTitle, startedAt: now,
        } })
      }
      const archived = await tx.orgUnit.updateMany({
        where: { id: unit.id, companyId, status: 'ACTIVE', version: input.expectedVersion },
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      })
      if (archived.count !== 1) throw conflict('Підрозділ уже змінено іншим адміністратором.')
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'org_unit.archived', entityType: 'ORG_UNIT', entityId: unit.id, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ destinationId: destination.id, employeesMoved: unit.assignments.length, childrenMoved: unit.children.length }), correlationId: id('corr'),
      } })
    }))
    return { id: unit.id, archived: true as const, version: input.expectedVersion + 1, destinationId: destination.id }
  }

  async restoreUnit(principal: AuthPrincipal, companyId: string, unitId: string, input: RestoreOrgUnitInput) {
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: unitId, workspaceId: principal.workspaceId, companyId, status: 'ARCHIVED' } })
    if (!unit) throw notFound()
    if (unit.version !== input.expectedVersion) throw conflict('Підрозділ уже змінено іншим адміністратором.')
    const parentId = input.parentId !== undefined ? input.parentId : unit.parentId
    const name = input.name ?? unit.name
    if (parentId) {
      await this.activeParent(principal, companyId, parentId)
      if (parentId === unit.id || this.descendantIds(unit.id, await this.allUnits(companyId)).has(parentId)) throw conflict('Не можна відновити підрозділ у його дочірній гілці.')
    }
    await this.assertUniqueName(companyId, parentId, name, unit.id)
    const sortOrder = await this.nextSortOrder(companyId, parentId)
    await this.uniqueNameGuard(() => this.prisma.$transaction(async (tx) => {
      const result = await tx.orgUnit.updateMany({
        where: { id: unit.id, companyId, status: 'ARCHIVED', version: input.expectedVersion },
        data: { status: 'ACTIVE', parentId, name: normalizeName(name), normalizedName: normalizedName(name), sortOrder, version: { increment: 1 } },
      })
      if (result.count !== 1) throw conflict('Підрозділ уже змінено іншим адміністратором.')
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'org_unit.restored', entityType: 'ORG_UNIT', entityId: unit.id, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ parentId, name: normalizeName(name) }), correlationId: id('corr'),
      } })
    }))
    return { id: unit.id, restored: true as const, version: input.expectedVersion + 1 }
  }

  async listEmployees(principal: AuthPrincipal, unitId: string, company?: string): Promise<{ items: OrgUnitEmployeeView[] }> {
    const companyIds = company ? [this.scope.assertCompany(principal, company)] : principal.allowedCompanyIds
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id: unitId, workspaceId: principal.workspaceId, companyId: { in: companyIds }, status: 'ACTIVE' }, select: { id: true, companyId: true },
    })
    if (!unit) throw notFound()
    const assignments = await this.prisma.userOrgAssignment.findMany({
      where: { orgUnitId: unit.id, companyId: unit.companyId, endedAt: null, isPrimary: true, user: { isActive: true, accountType: 'USER', primaryCompanyId: unit.companyId } },
      select: { isPrimary: true, positionTitle: true, user: { select: { id: true, displayName: true, jobTitle: true, avatarAsset: true } } },
      orderBy: { user: { displayName: 'asc' } },
    })
    return { items: assignments.map((assignment) => ({ ...assignment.user, positionTitle: assignment.positionTitle, isPrimary: assignment.isPrimary })) }
  }
}
