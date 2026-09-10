import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, search?: string) {
    const audiences = await this.prisma.articleAudience.findMany({ where: { OR: [{ principalType: 'COMPANY', principalId: { in: principal.allowedCompanyIds } }, { principalType: 'USER', principalId: principal.userId }] }, select: { articleId: true } })
    const rows = await this.prisma.knowledgeArticle.findMany({ where: { id: { in: audiences.map((entry) => entry.articleId) }, status: 'ACTIVE', ...(search ? { versions: { some: { OR: [{ title: { contains: search } }, { body: { contains: search } }] } } } : {}) }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } })
    return { items: rows.map((row) => ({ id: row.id, slug: row.slug, title: row.versions[0]?.title ?? row.slug, changeSummary: row.versions[0]?.changeSummary ?? '', reviewAt: row.reviewAt?.toISOString() ?? null, version: row.version, updatedAt: row.updatedAt.toISOString() })) }
  }

  async detail(principal: AuthPrincipal, slug: string) {
    const resolved = await this.prisma.knowledgeArticle.findFirst({ where: { slug, status: 'ACTIVE' }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
    if (!resolved) throw notFound()
    const audience = await this.prisma.articleAudience.findFirst({ where: { articleId: resolved.id, OR: [{ principalType: 'COMPANY', principalId: { in: principal.allowedCompanyIds } }, { principalType: 'USER', principalId: principal.userId }] } })
    if (!audience) throw notFound()
    const acknowledgement = await this.prisma.acknowledgement.findFirst({ where: { entityType: 'ARTICLE', entityId: resolved.id, version: resolved.version, userId: principal.userId } })
    const attachmentLinks = await this.prisma.fileLink.findMany({ where: { entityType: 'KNOWLEDGE_ARTICLE', entityId: resolved.id, purpose: 'ATTACHMENT' }, select: { fileId: true } })
    const attachmentRows = attachmentLinks.length === 0 ? [] : await this.prisma.fileObject.findMany({ where: { id: { in: attachmentLinks.map((link) => link.fileId) }, workspaceId: principal.workspaceId }, select: { id: true, safeFilename: true, bytes: true, detectedMime: true, scanStatus: true } })
    const attachments = attachmentRows.map(({ detectedMime, ...file }) => ({ ...file, mimeType: detectedMime }))
    const audienceRows = await this.prisma.articleAudience.findMany({ where: { articleId: resolved.id, principalType: 'COMPANY' }, select: { principalId: true } })
    return { ...resolved, currentVersion: resolved.versions[0] ?? null, acknowledgement, attachments, companyIds: audienceRows.map((row) => row.principalId) }
  }

  async create(principal: AuthPrincipal, input: { slug: string; title: string; body: string; companyIds: string[]; attachmentIds?: string[]; reviewAt?: string }) {
    const slug = input.slug.trim().toLowerCase()
    if (!/^[a-z0-9-]{3,80}$/.test(slug) || !input.title.trim() || !input.body.trim()) throw badRequest('article_fields')
    if (!input.companyIds.length || input.companyIds.some((company) => !principal.allowedCompanyIds.includes(company))) throw badRequest('article_audience')
    const attachmentIds = await this.assertAttachments(principal, input.attachmentIds)
    const articleId = id('art')
    const versionId = id('artv')
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeArticle.create({ data: { id: articleId, workspaceId: principal.workspaceId, slug, ownerId: principal.userId, status: 'ACTIVE', currentVersionId: versionId, reviewAt: input.reviewAt ? new Date(input.reviewAt) : null } })
      await tx.knowledgeArticleVersion.create({ data: { id: versionId, articleId, version: 1, title: input.title.trim(), body: input.body.trim(), changeSummary: 'Перша публікація', createdBy: principal.userId, publishedAt: new Date() } })
      await tx.articleAudience.createMany({ data: input.companyIds.map((companyId) => ({ id: id('audn'), articleId, principalType: 'COMPANY', principalId: companyId })) })
      if (attachmentIds.length) await tx.fileLink.createMany({ data: attachmentIds.map((fileId) => ({ id: id('fln'), fileId, entityType: 'KNOWLEDGE_ARTICLE', entityId: articleId, purpose: 'ATTACHMENT', aclMode: 'INHERIT' })) })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'knowledge.published', entityType: 'ARTICLE', entityId: articleId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { id: articleId, slug }
  }

  async update(principal: AuthPrincipal, slug: string, input: { title: string; body: string; changeSummary: string; companyIds?: string[]; attachmentIds?: string[]; expectedVersion: number }) {
    if (principal.accountType !== 'ADMIN') throw forbidden()
    if (typeof input.title !== 'string' || !input.title.trim() || typeof input.body !== 'string' || !input.body.trim() || typeof input.changeSummary !== 'string' || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw badRequest('article_fields')
    // Audience is optional on update; an empty selection would orphan the
    // article, so it is rejected the same way it is on create.
    const companyIds = input.companyIds
    if (companyIds && (!companyIds.length || companyIds.some((company) => !principal.allowedCompanyIds.includes(company)))) throw badRequest('article_audience')
    const article = await this.detail(principal, slug)
    if (article.workspaceId !== principal.workspaceId) throw notFound()
    const attachmentIds = await this.assertAttachments(principal, input.attachmentIds)
    const versionId = id('artv')
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeArticle.updateMany({ where: { id: article.id, workspaceId: principal.workspaceId, version: input.expectedVersion, status: 'ACTIVE' }, data: { version: { increment: 1 }, currentVersionId: versionId } })
      if (updated.count !== 1) throw conflict('Матеріал уже змінено. Відкрийте його повторно, щоб завантажити актуальну версію.')
      await tx.knowledgeArticleVersion.create({ data: { id: versionId, articleId: article.id, version: input.expectedVersion + 1, title: input.title.trim(), body: input.body.trim(), changeSummary: input.changeSummary.trim() || 'Оновлено матеріал', createdBy: principal.userId, publishedAt: new Date() } })
      if (companyIds) {
        await tx.articleAudience.deleteMany({ where: { articleId: article.id, principalType: 'COMPANY' } })
        await tx.articleAudience.createMany({ data: companyIds.map((companyId) => ({ id: id('audn'), articleId: article.id, principalType: 'COMPANY', principalId: companyId })) })
      }
      for (const fileId of attachmentIds) await tx.fileLink.upsert({ where: { fileId_entityType_entityId_purpose: { fileId, entityType: 'KNOWLEDGE_ARTICLE', entityId: article.id, purpose: 'ATTACHMENT' } }, create: { id: id('fln'), fileId, entityType: 'KNOWLEDGE_ARTICLE', entityId: article.id, purpose: 'ATTACHMENT', aclMode: 'INHERIT' }, update: {} })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'knowledge.published', entityType: 'ARTICLE', entityId: article.id, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { id: article.id, slug }
  }

  async archive(principal: AuthPrincipal, slug: string, expectedVersion: number) {
    if (principal.accountType !== 'ADMIN') throw forbidden()
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('article_version')
    const article = await this.detail(principal, slug)
    const updated = await this.prisma.knowledgeArticle.updateMany({ where: { id: article.id, workspaceId: principal.workspaceId, status: 'ACTIVE', version: expectedVersion }, data: { status: 'ARCHIVED', version: { increment: 1 } } })
    if (updated.count !== 1) throw conflict('Матеріал уже змінено. Оновіть сторінку та повторіть дію.')
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'knowledge.archived', entityType: 'ARTICLE', entityId: article.id, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    return { archived: true }
  }

  private async assertAttachments(principal: AuthPrincipal, input: string[] | undefined) {
    const ids = [...new Set(input ?? [])]
    if (ids.length === 0) return []
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: ids }, workspaceId: principal.workspaceId, ownerId: principal.userId, scanStatus: 'CLEAN' }, select: { id: true } })
    if (files.length !== ids.length) throw badRequest('article_attachment_invalid')
    return ids
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
