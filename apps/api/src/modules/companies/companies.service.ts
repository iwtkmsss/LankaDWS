import { Injectable } from '@nestjs/common'
import type { CompanyInput } from '@bert-crm/contracts'
import { conflict, notFound } from '../../common/errors.js'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(company: { id: string; displayName: string; code: string; isActive: boolean; timezone: string; createdAt: Date; updatedAt: Date }) {
    return { id: company.id, name: company.displayName, slug: company.code, isActive: company.isActive, timezone: company.timezone, createdAt: company.createdAt.toISOString(), updatedAt: company.updatedAt.toISOString() }
  }

  async list(principal: AuthPrincipal) {
    const companies = await this.prisma.company.findMany({
      where: { workspaceId: principal.workspaceId },
      include: { _count: { select: { primaryUsers: true } } },
      orderBy: { displayName: 'asc' },
    })
    return { items: companies.map((company) => ({ ...this.view(company), userCount: company._count.primaryUsers })) }
  }

  async detail(principal: AuthPrincipal, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
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
    const company = await this.prisma.company.create({ data: { id: id('cmp'), workspaceId: principal.workspaceId, displayName: input.name, legalName: input.name, code: input.slug, timezone: input.timezone, isActive: input.isActive } })
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company.id, actorType: 'USER', actorId: principal.userId, action: 'company.created', entityType: 'COMPANY', entityId: company.id, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    return this.view(company)
  }

  async update(principal: AuthPrincipal, companyId: string, input: CompanyInput) {
    const existing = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
    if (!existing) throw notFound()
    const sameSlug = await this.prisma.company.findFirst({ where: { workspaceId: principal.workspaceId, code: input.slug, id: { not: companyId } } })
    if (sameSlug) throw conflict('company_slug_taken')
    const company = await this.prisma.company.update({ where: { id: companyId }, data: { displayName: input.name, legalName: input.name, code: input.slug, timezone: input.timezone, isActive: input.isActive } })
    return this.view(company)
  }

  async setActive(principal: AuthPrincipal, companyId: string, isActive: boolean) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId } })
    if (!company) throw notFound()
    await this.prisma.company.update({ where: { id: companyId }, data: { isActive } })
    return { id: companyId, isActive }
  }
}
