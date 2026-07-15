import { Injectable } from '@nestjs/common'
import type { DocumentListItem } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async list(principal: AuthPrincipal, company?: string, search?: string): Promise<{ items: DocumentListItem[] }> {
    const rows = await this.prisma.document.findMany({ where: {
      companyId: { in: this.scope.allowedCompanies(principal, company) }, archivedAt: null,
      ...(search ? { name: { contains: search } } : {}),
      OR: [{ ownerId: principal.userId }, { confidentiality: { in: ['GENERAL', 'INTERNAL'] } }, { id: { in: await this.allowedDocumentIds(principal) } }],
    }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] })
    const owners = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.ownerId))] } }, select: { id: true, displayName: true } })
    const ownerById = new Map(owners.map((owner) => [owner.id, owner.displayName]))
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: rows.flatMap((row) => row.versions.map((version) => version.fileId)) } }, select: { id: true, detectedMime: true, declaredMime: true } })
    const fileById = new Map(files.map((file) => [file.id, file]))
    return { items: rows.map((row) => ({ id: row.id, number: row.number, companyId: row.companyId, name: row.name, mimeType: row.versions[0] ? (fileById.get(row.versions[0].fileId)?.detectedMime ?? fileById.get(row.versions[0].fileId)?.declaredMime ?? null) : null, ownerName: ownerById.get(row.ownerId) ?? 'Недоступний користувач', status: row.status, updatedAt: row.updatedAt.toISOString(), version: row.version })) }
  }

  async detail(principal: AuthPrincipal, documentId: string) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, companyId: { in: principal.allowedCompanyIds }, OR: [{ ownerId: principal.userId }, { confidentiality: { in: ['GENERAL', 'INTERNAL'] } }, { id: { in: await this.allowedDocumentIds(principal) } }] }, include: { versions: { orderBy: { version: 'desc' } } } })
    if (!document) throw notFound()
    return document
  }

  async create(principal: AuthPrincipal, input: { companyId?: string; name: string; fileId: string; changeSummary?: string }) {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    const file = await this.prisma.fileObject.findFirst({ where: { id: input.fileId, companyId, ownerId: principal.userId } })
    if (!file) throw badRequest('file_invalid')
    const documentId = id('doc')
    const versionId = id('docv')
    await this.prisma.$transaction(async (tx) => {
      await tx.document.create({ data: { id: documentId, workspaceId: principal.workspaceId, companyId, number: `DOC-${Date.now().toString().slice(-7)}`, name: input.name.trim(), ownerId: principal.userId, status: 'DRAFT', currentVersionId: versionId } })
      await tx.documentVersion.create({ data: { id: versionId, documentId, version: 1, fileId: file.id, createdBy: principal.userId, changeSummary: input.changeSummary?.trim() ?? 'Перша версія', status: 'DRAFT' } })
      await tx.fileLink.create({ data: { id: id('fln'), fileId: file.id, entityType: 'DOCUMENT', entityId: documentId, purpose: 'VERSION', aclMode: 'INHERIT' } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId, action: 'document.created', entityType: 'DOCUMENT', entityId: documentId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return this.detail(principal, documentId)
  }

  async publish(principal: AuthPrincipal, documentId: string, expectedVersion: number) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, ownerId: principal.userId, companyId: { in: principal.allowedCompanyIds } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
    if (!document) throw notFound()
    if (document.version !== expectedVersion || !document.versions[0]) throw conflict()
    const version = document.versions[0]
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { status: 'PUBLISHED', version: { increment: 1 }, currentVersionId: version.id } })
      await tx.documentVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: document.companyId, actorType: 'USER', actorId: principal.userId, action: 'document.published', entityType: 'DOCUMENT', entityId: document.id, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ version: version.version }), correlationId: id('corr') } })
    })
    return { published: true, version: expectedVersion + 1 }
  }

  private async allowedDocumentIds(principal: AuthPrincipal): Promise<string[]> {
    const acl = await this.prisma.documentAcl.findMany({ where: { OR: [{ principalType: 'USER', principalId: principal.userId }, { principalType: 'ROLE', principalId: { in: [...principal.permissions] } }] }, select: { documentId: true } })
    return acl.map((entry) => entry.documentId)
  }
}
