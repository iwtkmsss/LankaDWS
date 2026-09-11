import { Injectable } from '@nestjs/common'
import type { CompanyInput, UpdateCompanyManagerInput } from '@lankadws/contracts'
import { conflict, notFound } from '../../common/errors.js'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(company: { id: string; displayName: string; code: string; description: string | null; isActive: boolean; timezone: string; version: number; createdAt: Date; updatedAt: Date; manager?: { id: string; displayName: string; jobTitle: string; isActive: boolean; primaryCompanyId: string | null } | null }) {
    // A manager must be an active member of this company; global admin status
    // alone does not qualify (docs/decisions.md 2026-09-09).
    const manager = company.manager?.isActive && company.manager.primaryCompanyId === company.id
      ? { id: company.manager.id, displayName: company.manager.displayName, jobTitle: company.manager.jobTitle }
      : null
    return { id: company.id, name: company.displayName, slug: company.code, description: company.description, isActive: company.isActive, timezone: company.timezone, version: company.version, manager, createdAt: company.createdAt.toISOString(), updatedAt: company.updatedAt.toISOString() }
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

  async create(principal: AuthPrincipal, input: CompanyInput) {
    const exists = await this.prisma.company.findUnique({ where: { workspaceId_code: { workspaceId: principal.workspaceId, code: input.slug } } })
    if (exists) throw conflict('company_slug_taken')
    const company = await this.prisma.company.create({ data: { id: id('cmp'), workspaceId: principal.workspaceId, displayName: input.name, legalName: input.name, code: input.slug, description: input.description, timezone: input.timezone, isActive: input.isActive } })
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company.id, actorType: 'USER', actorId: principal.userId, action: 'company.created', entityType: 'COMPANY', entityId: company.id, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    return this.view(company)
  }

  async update(principal: AuthPrincipal, companyId: string, input: CompanyInput) {
    const existing = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
    if (!existing) throw notFound()
    const sameSlug = await this.prisma.company.findFirst({ where: { workspaceId: principal.workspaceId, code: input.slug, id: { not: companyId } } })
    if (sameSlug) throw conflict('company_slug_taken')
    const company = await this.prisma.company.update({ where: { id: companyId }, data: { displayName: input.name, legalName: input.name, code: input.slug, description: input.description, timezone: input.timezone, isActive: input.isActive, version: { increment: 1 } }, include: { manager: { select: { id: true, displayName: true, jobTitle: true, isActive: true, primaryCompanyId: true } } } })
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
