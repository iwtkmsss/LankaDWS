import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, search?: string) {
    const audiences = await this.prisma.articleAudience.findMany({ where: { OR: [{ principalType: 'COMPANY', principalId: { in: principal.allowedCompanyIds } }, { principalType: 'USER', principalId: principal.userId }, { principalType: 'ROLE', principalId: { in: [principal.displayRole] } }] }, select: { articleId: true } })
    const rows = await this.prisma.knowledgeArticle.findMany({ where: { id: { in: audiences.map((entry) => entry.articleId) }, status: 'ACTIVE', ...(search ? { versions: { some: { OR: [{ title: { contains: search } }, { body: { contains: search } }] } } } : {}) }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } })
    return { items: rows.map((row) => ({ id: row.id, slug: row.slug, title: row.versions[0]?.title ?? row.slug, changeSummary: row.versions[0]?.changeSummary ?? '', reviewAt: row.reviewAt?.toISOString() ?? null, version: row.version, updatedAt: row.updatedAt.toISOString() })) }
  }

  async detail(principal: AuthPrincipal, slug: string) {
    const resolved = await this.prisma.knowledgeArticle.findFirst({ where: { slug, status: 'ACTIVE' }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
    if (!resolved) throw notFound()
    const audience = await this.prisma.articleAudience.findFirst({ where: { articleId: resolved.id, OR: [{ principalType: 'COMPANY', principalId: { in: principal.allowedCompanyIds } }, { principalType: 'USER', principalId: principal.userId }, { principalType: 'ROLE', principalId: principal.displayRole }] } })
    if (!audience) throw notFound()
    const acknowledgement = await this.prisma.acknowledgement.findFirst({ where: { entityType: 'ARTICLE', entityId: resolved.id, version: resolved.version, userId: principal.userId } })
    return { ...resolved, currentVersion: resolved.versions[0] ?? null, acknowledgement }
  }

  async create(principal: AuthPrincipal, input: { slug: string; title: string; body: string; companyIds: string[]; reviewAt?: string }) {
    const slug = input.slug.trim().toLowerCase()
    if (!/^[a-z0-9-]{3,80}$/.test(slug) || !input.title.trim() || !input.body.trim()) throw badRequest('article_fields')
    if (!input.companyIds.length || input.companyIds.some((company) => !principal.allowedCompanyIds.includes(company))) throw badRequest('article_audience')
    const articleId = id('art')
    const versionId = id('artv')
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeArticle.create({ data: { id: articleId, workspaceId: principal.workspaceId, slug, ownerId: principal.userId, status: 'ACTIVE', currentVersionId: versionId, reviewAt: input.reviewAt ? new Date(input.reviewAt) : null } })
      await tx.knowledgeArticleVersion.create({ data: { id: versionId, articleId, version: 1, title: input.title.trim(), body: input.body.trim(), changeSummary: 'Перша публікація', createdBy: principal.userId, publishedAt: new Date() } })
      await tx.articleAudience.createMany({ data: input.companyIds.map((companyId) => ({ id: id('audn'), articleId, principalType: 'COMPANY', principalId: companyId })) })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'knowledge.published', entityType: 'ARTICLE', entityId: articleId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { id: articleId, slug }
  }

  async acknowledge(principal: AuthPrincipal, slug: string, expectedVersion: number) {
    const article = await this.detail(principal, slug)
    if (article.version !== expectedVersion) throw conflict()
    await this.prisma.acknowledgement.upsert({
      where: { entityType_entityId_version_userId: { entityType: 'ARTICLE', entityId: article.id, version: expectedVersion, userId: principal.userId } },
      create: { id: id('ack'), entityType: 'ARTICLE', entityId: article.id, version: expectedVersion, userId: principal.userId, dueAt: new Date(Date.now() + 7 * 86_400_000), openedAt: new Date(), confirmedAt: new Date() },
      update: { confirmedAt: new Date() },
    })
    return { confirmed: true }
  }
}
