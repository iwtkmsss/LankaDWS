import { Controller, Get, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async search(@Req() request: BertRequest, @Query('q') query = '', @Query('company') company?: string) {
    const principal = principalFrom(request)
    const q = query.trim().slice(0, 120)
    if (q.length < 2) return { items: [] }
    const companyIds = this.scope.allowedCompanies(principal, company)
    const [tasks, requests, documents, users, articles] = await Promise.all([
      principal.permissions.has('tasks.read') ? this.prisma.task.findMany({ where: { companyId: { in: companyIds }, title: { contains: q }, OR: [{ assigneeId: principal.userId }, { creatorId: principal.userId }, ...(principal.permissions.has('tasks.manage') ? [{}] : [])] }, select: { id: true, title: true, companyId: true, status: true }, take: 6 }) : [],
      principal.permissions.has('requests.read') ? this.prisma.request.findMany({ where: { companyId: { in: companyIds }, OR: [{ authorId: principal.userId }, { currentApproverId: principal.userId }], snapshots: { some: { safeSummary: { contains: q } } } }, include: { snapshots: { orderBy: { version: 'desc' }, take: 1 } }, take: 6 }) : [],
      principal.permissions.has('documents.read') ? this.prisma.document.findMany({ where: { companyId: { in: companyIds }, name: { contains: q }, confidentiality: { in: ['GENERAL', 'INTERNAL'] } }, select: { id: true, name: true, companyId: true, status: true }, take: 6 }) : [],
      principal.permissions.has('employees.read') ? this.prisma.user.findMany({ where: { status: 'ACTIVE', displayName: { contains: q }, companyAccess: { some: { companyId: { in: companyIds }, status: 'ACTIVE' } } }, select: { id: true, displayName: true, primaryCompanyId: true, jobTitle: true }, take: 6 }) : [],
      principal.permissions.has('knowledge.read') ? this.prisma.knowledgeArticle.findMany({ where: { status: 'ACTIVE', versions: { some: { title: { contains: q } } } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, take: 6 }) : [],
    ])
    return { items: [
      ...tasks.map((item) => ({ type: 'TASK', id: item.id, title: item.title, safeSnippet: item.status, companyId: item.companyId, route: `/tasks/${item.id}` })),
      ...requests.map((item) => ({ type: 'REQUEST', id: item.id, title: item.number, safeSnippet: item.snapshots[0]?.safeSummary ?? 'Заявка', companyId: item.companyId, route: `/requests/${item.id}` })),
      ...documents.map((item) => ({ type: 'DOCUMENT', id: item.id, title: item.name, safeSnippet: item.status, companyId: item.companyId, route: `/documents/${item.id}` })),
      ...users.map((item) => ({ type: 'EMPLOYEE', id: item.id, title: item.displayName, safeSnippet: item.jobTitle, companyId: item.primaryCompanyId, route: `/employees/${item.id}` })),
      ...articles.map((item) => ({ type: 'ARTICLE', id: item.id, title: item.versions[0]?.title ?? item.slug, safeSnippet: '', companyId: null, route: `/knowledge/${item.slug}` })),
    ] }
  }
}
