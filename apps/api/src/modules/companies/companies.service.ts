import { Injectable } from '@nestjs/common'
import type { CompanyInput, CreateCompanyInput, UpdateCompanyManagerInput } from '@lankadws/contracts'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(company: { logoFileId?: string | null; id: string; displayName: string; code: string; description: string | null; isActive: boolean; timezone: string; version: number; createdAt: Date; updatedAt: Date; manager?: { id: string; displayName: string; jobTitle: string; isActive: boolean; primaryCompanyId: string | null } | null }) {
    // A manager must be an active member of this company; global admin status
    // alone does not qualify (docs/decisions.md 2026-09-09).
    const manager = company.manager?.isActive && company.manager.primaryCompanyId === company.id
      ? { id: company.manager.id, displayName: company.manager.displayName, jobTitle: company.manager.jobTitle }
      : null
    return { logoFileId: company.logoFileId ?? null, logoAsset: company.logoFileId ? `/api/v1/companies/${company.id}/logo/${company.logoFileId}` : null, id: company.id, name: company.displayName, slug: company.code, description: company.description, isActive: company.isActive, timezone: company.timezone, version: company.version, manager, createdAt: company.createdAt.toISOString(), updatedAt: company.updatedAt.toISOString() }
  }

  async list(principal: AuthPrincipal, activeOnly = false) {
    const companies = await this.prisma.company.findMany({
      where: { workspaceId: principal.workspaceId, ...(activeOnly ? { isActive: true } : {}) },
      include: { manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } }, _count: { select: { primaryUsers: true, orgUnits: true } } },
      orderBy: { displayName: 'asc' },
    })
    return { items: companies.map((company) => ({ ...this.view(company), userCount: company._count.primaryUsers, unitCount: company._count.orgUnits })) }
  }

  async detail(principal: AuthPrincipal, companyId: string, activeOnly = false) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId, ...(activeOnly ? { isActive: true } : {}) }, include: { manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } } } })
    if (!company) throw notFound()
    const [users, units, members] = await Promise.all([
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, primaryCompanyId: companyId } }),
      this.prisma.orgUnit.count({ where: { workspaceId: principal.workspaceId, companyId } }),
      this.prisma.user.findMany({ where: { workspaceId: principal.workspaceId, primaryCompanyId: companyId }, orderBy: { displayName: 'asc' }, take: 6, select: { id: true, displayName: true, jobTitle: true, isActive: true } }),
    ])
    return { ...this.view(company), counts: { users, units }, members }
  }

  private async assertLogo(principal: AuthPrincipal, fileId: string | null | undefined) {
    if (!fileId) return
    const file = await this.prisma.fileObject.findFirst({ where: {
      id: fileId, workspaceId: principal.workspaceId, companyId: null, ownerId: principal.userId,
      scanStatus: 'CLEAN', detectedMime: { in: ['image/png', 'image/jpeg', 'image/webp'] },
      bytes: { lte: 2 * 1024 * 1024 },
    }, select: { id: true } })
    if (!file) throw badRequest('Логотип недоступний або ще не пройшов перевірку.')
  }

  async create(principal: AuthPrincipal, input: CreateCompanyInput) {
    await this.assertLogo(principal, input.logoFileId)
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.company.findUnique({ where: { workspaceId_code: { workspaceId: principal.workspaceId, code: input.slug } } })
      if (exists) throw conflict('company_slug_taken')
      const employeeIds = [...new Set([...(input.employeeIds ?? []), ...(input.managerId ? [input.managerId] : [])])]
      if (employeeIds.length) {
        const employees = await tx.user.findMany({ where: { id: { in: employeeIds }, workspaceId: principal.workspaceId, accountType: 'USER', isActive: true }, select: { id: true, primaryCompanyId: true } })
        if (employees.length !== employeeIds.length) throw notFound()
      }
      const company = await tx.company.create({ data: { id: id('cmp'), workspaceId: principal.workspaceId, displayName: input.name, legalName: input.name, logoFileId: input.logoFileId, code: input.slug, description: input.description, timezone: input.timezone, isActive: input.isActive } })
      if (employeeIds.length) {
        // Match account transfers: clear old leadership and retain assignment history.
        await tx.company.updateMany({ where: { workspaceId: principal.workspaceId, managerId: { in: employeeIds } }, data: { managerId: null, version: { increment: 1 } } })
        await tx.orgUnit.updateMany({ where: { workspaceId: principal.workspaceId, managerId: { in: employeeIds } }, data: { managerId: null, version: { increment: 1 } } })
        await tx.userOrgAssignment.updateMany({ where: { userId: { in: employeeIds }, endedAt: null }, data: { endedAt: new Date(), isPrimary: false } })
        await tx.user.updateMany({ where: { id: { in: employeeIds }, workspaceId: principal.workspaceId, accountType: 'USER', isActive: true }, data: { primaryCompanyId: company.id, authorizationVersion: { increment: 1 } } })
      }
      const saved = input.managerId ? await tx.company.update({ where: { id: company.id }, data: { managerId: input.managerId }, include: { manager: true } }) : company
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company.id, actorType: 'USER', actorId: principal.userId, action: 'company.created', entityType: 'COMPANY', entityId: company.id, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ managerId: input.managerId ?? null, employeeIds }), correlationId: id('corr') } })
      return this.view(saved)
    })
  }

  async update(principal: AuthPrincipal, companyId: string, input: CompanyInput) {
    const existing = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
    if (!existing) throw notFound()
    if (input.logoFileId !== existing.logoFileId) await this.assertLogo(principal, input.logoFileId)
    const sameSlug = await this.prisma.company.findFirst({ where: { workspaceId: principal.workspaceId, code: input.slug, id: { not: companyId } } })
    if (sameSlug) throw conflict('company_slug_taken')
    const company = await this.prisma.company.update({ where: { id: companyId }, data: { displayName: input.name, legalName: input.name, logoFileId: input.logoFileId, code: input.slug, description: input.description, timezone: input.timezone, isActive: input.isActive, version: { increment: 1 } }, include: { manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } } } })
    return this.view(company)
  }

  async updateManager(principal: AuthPrincipal, companyId: string, input: UpdateCompanyManagerInput) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId }, select: { id: true, version: true } })
    if (!company) throw notFound()
    if (company.version !== input.expectedVersion) throw conflict('Компанію вже змінено іншим адміністратором.')
    if (input.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: input.managerId, workspaceId: principal.workspaceId, isActive: true, accountType: 'USER', primaryCompanyId: companyId },
        select: { id: true },
      })
      if (!manager) throw notFound()
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.updateMany({ where: { id: companyId, workspaceId: principal.workspaceId, version: input.expectedVersion }, data: { managerId: input.managerId, version: { increment: 1 } } })
      if (updated.count !== 1) throw conflict('Компанію вже змінено іншим адміністратором.')
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'company.manager_updated', entityType: 'COMPANY', entityId: companyId, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ managerId: input.managerId }), correlationId: id('corr'),
      } })
    })
    return { id: companyId, managerId: input.managerId, version: input.expectedVersion + 1 }
  }

  async setActive(principal: AuthPrincipal, companyId: string, isActive: boolean) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
    if (!company) throw notFound()
    await this.prisma.company.update({ where: { id: companyId }, data: { isActive } })
    return { id: companyId, isActive }
  }
}
