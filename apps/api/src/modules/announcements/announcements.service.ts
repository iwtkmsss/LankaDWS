import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

interface DraftInput {
  title: string
  body: string
  companyIds: string[]
  userIds?: string[]
  isPinned?: boolean
  publishAt?: string
  expiresAt?: string
}

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async list(principal: AuthPrincipal, company?: string, state = 'active') {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const receipts = await this.prisma.announcementReceipt.findMany({ where: {
      userId: principal.userId,
      announcement: {
        ...(state === 'archive' ? { status: 'ARCHIVED' } : { status: { in: ['PUBLISHED', 'SCHEDULED'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }),
        companies: { some: { companyId: { in: companyIds } } },
      },
    }, include: { announcement: { include: { companies: true } } }, orderBy: [{ announcement: { isPinned: 'desc' } }, { deliveredAt: 'desc' }] })
    const authorIds = [...new Set(receipts.map((receipt) => receipt.announcement.authorId))]
    const authors = await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } })
    const authorById = new Map(authors.map((author) => [author.id, author.displayName]))
    return { items: receipts.map((receipt) => ({ id: receipt.announcement.id, title: receipt.announcement.title, safeSnippet: receipt.announcement.body.slice(0, 180), authorName: authorById.get(receipt.announcement.authorId) ?? 'BERT CRM', companyIds: receipt.announcement.companies.map((entry) => entry.companyId), status: receipt.announcement.status, isPinned: receipt.announcement.isPinned, publishedAt: receipt.announcement.publishAt?.toISOString() ?? null, readAt: receipt.readAt?.toISOString() ?? null })) }
  }

  async detail(principal: AuthPrincipal, announcementId: string) {
    const receipt = await this.prisma.announcementReceipt.findUnique({ where: { announcementId_userId: { announcementId, userId: principal.userId } }, include: { announcement: { include: { companies: true, users: true } } } })
    if (!receipt) throw notFound()
    return { ...receipt.announcement, receipt: { readAt: receipt.readAt, dismissedAt: receipt.dismissedAt }, audience: { companyIds: receipt.announcement.companies.map((entry) => entry.companyId), userIds: receipt.announcement.users.map((entry) => entry.userId) } }
  }

  async audiencePreview(principal: AuthPrincipal, input: Pick<DraftInput, 'companyIds' | 'userIds'>) {
    this.assertAudience(principal, input.companyIds)
    const users = await this.resolveAudience(input)
    return { recipientCount: users.length, inaccessibleRelatedDocuments: 0 }
  }

  async createDraft(principal: AuthPrincipal, input: DraftInput) {
    this.assertAudience(principal, input.companyIds)
    if (!input.title.trim() || input.title.length > 180 || !input.body.trim() || input.body.length > 10_000) throw badRequest('announcement_fields')
    const announcementId = id('ann')
    await this.prisma.$transaction(async (tx) => {
      await tx.announcement.create({ data: { id: announcementId, workspaceId: principal.workspaceId, authorId: principal.userId, title: input.title.trim(), body: input.body.trim(), status: 'DRAFT', isPinned: Boolean(input.isPinned), publishAt: input.publishAt ? new Date(input.publishAt) : null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } })
      await tx.announcementAudienceCompany.createMany({ data: input.companyIds.map((companyId) => ({ id: id('anc'), announcementId, companyId })) })
      if (input.userIds?.length) await tx.announcementAudienceUser.createMany({ data: input.userIds.map((userId) => ({ id: id('anu'), announcementId, userId })) })
    })
    return { id: announcementId, status: 'DRAFT', version: 1 }
  }

  async publish(principal: AuthPrincipal, announcementId: string, expectedVersion: number) {
    const announcement = await this.prisma.announcement.findFirst({ where: { id: announcementId, authorId: principal.userId }, include: { companies: true, users: true } })
    if (!announcement) throw notFound()
    if (announcement.version !== expectedVersion || announcement.status !== 'DRAFT') throw conflict()
    const scheduled = announcement.publishAt && announcement.publishAt > new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.announcement.update({ where: { id: announcement.id }, data: { status: scheduled ? 'SCHEDULED' : 'PUBLISHED', publishAt: announcement.publishAt ?? new Date(), version: { increment: 1 } } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: scheduled ? 'announcement.scheduled' : 'announcement.published', entityType: 'ANNOUNCEMENT', entityId: announcement.id, result: 'SUCCESS', risk: 'NORMAL', safeDiffJson: JSON.stringify({ version: expectedVersion + 1 }), correlationId: id('corr') } })
      await tx.outboxEvent.create({ data: { id: id('out'), aggregateType: 'ANNOUNCEMENT', aggregateId: announcement.id, aggregateVersion: expectedVersion + 1, eventType: 'announcement.materialize', safePayload: '{}', nextRunAt: announcement.publishAt ?? new Date() } })
    })
    return { status: scheduled ? 'SCHEDULED' : 'PUBLISHED', version: expectedVersion + 1 }
  }

  async markRead(principal: AuthPrincipal, announcementId: string, read: boolean) {
    const result = await this.prisma.announcementReceipt.updateMany({ where: { announcementId, userId: principal.userId }, data: { readAt: read ? new Date() : null } })
    if (!result.count) throw notFound()
    return { read }
  }

  async archive(principal: AuthPrincipal, announcementId: string, expectedVersion: number) {
    const result = await this.prisma.announcement.updateMany({ where: { id: announcementId, authorId: principal.userId, version: expectedVersion }, data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } } })
    if (!result.count) throw conflict()
    return { archived: true, version: expectedVersion + 1 }
  }

  private assertAudience(principal: AuthPrincipal, companyIds: string[]): void {
    if (!companyIds.length || companyIds.some((companyId) => !principal.allowedCompanyIds.includes(companyId))) throw badRequest('announcement_audience')
  }

  private resolveAudience(input: Pick<DraftInput, 'companyIds' | 'userIds'>) {
    return this.prisma.user.findMany({ where: { isActive: true, OR: [{ primaryCompanyId: { in: input.companyIds } }, { id: { in: input.userIds ?? [] } }] }, select: { id: true } })
  }
}
