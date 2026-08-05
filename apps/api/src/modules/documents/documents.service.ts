import { Injectable } from '@nestjs/common'
import type { DocumentListItem } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

export type DocumentSection = 'ALL' | 'MINE' | 'SHARED' | 'DRAFTS' | 'ARCHIVED'
export type DocumentFileType = 'ALL' | 'DOCUMENT' | 'IMAGE' | 'OTHER'
type DocumentSort = 'RECENT' | 'NAME' | 'OWNER'

interface DocumentListQuery {
  company?: string
  search?: string
  section?: string
  fileType?: string
  sort?: string
}

export interface DriveDocumentListItem extends DocumentListItem {
  ownerId: string
  isOwner: boolean
  versionCount: number
  sizeBytes: number | null
  fileType: Exclude<DocumentFileType, 'ALL'>
  archivedAt: string | null
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async list(
    principal: AuthPrincipal,
    query: DocumentListQuery = {},
  ): Promise<{ items: DriveDocumentListItem[]; counts: Record<DocumentSection, number> }> {
    const section = (query.section ?? 'ALL') as DocumentSection
    const fileType = (query.fileType ?? 'ALL') as DocumentFileType
    const sort = (query.sort ?? 'RECENT') as DocumentSort
    if (!['ALL', 'MINE', 'SHARED', 'DRAFTS', 'ARCHIVED'].includes(section)
      || !['ALL', 'DOCUMENT', 'IMAGE', 'OTHER'].includes(fileType)
      || !['RECENT', 'NAME', 'OWNER'].includes(sort)) {
      throw badRequest('document_query_invalid')
    }
    const companyIds = this.scope.allowedCompanies(principal, query.company)
    const allowedIds = await this.allowedDocumentIds(principal)
    const rows = await this.prisma.document.findMany({
      where: {
        companyId: { in: companyIds },
        ...(query.search ? { name: { contains: query.search.trim() } } : {}),
        OR: [
          { ownerId: principal.userId },
          { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
          { id: { in: allowedIds } },
        ],
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { versions: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.ownerId))] } },
      select: { id: true, displayName: true },
    })
    const ownerById = new Map(owners.map((owner) => [owner.id, owner.displayName]))
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: rows.flatMap((row) => row.versions.map((version) => version.fileId)) } },
      select: { id: true, detectedMime: true, declaredMime: true, bytes: true },
    })
    const fileById = new Map(files.map((file) => [file.id, file]))
    const documents: DriveDocumentListItem[] = rows.map((row) => {
      const file = row.versions[0] ? fileById.get(row.versions[0].fileId) : undefined
      const mimeType = file?.detectedMime ?? file?.declaredMime ?? null
      return {
        id: row.id,
        number: row.number,
        companyId: row.companyId,
        name: row.name,
        mimeType,
        ownerId: row.ownerId,
        ownerName: ownerById.get(row.ownerId) ?? 'Недоступний користувач',
        isOwner: row.ownerId === principal.userId,
        status: row.archivedAt ? 'ARCHIVED' : row.status,
        updatedAt: row.updatedAt.toISOString(),
        version: row.version,
        versionCount: row._count.versions,
        sizeBytes: file?.bytes ?? null,
        fileType: this.fileType(mimeType),
        archivedAt: row.archivedAt?.toISOString() ?? null,
      }
    })
    const active = documents.filter((document) => !document.archivedAt)
    const counts: Record<DocumentSection, number> = {
      ALL: active.length,
      MINE: active.filter((document) => document.isOwner).length,
      SHARED: active.filter((document) => !document.isOwner).length,
      DRAFTS: active.filter((document) => document.status === 'DRAFT').length,
      ARCHIVED: documents.filter((document) => Boolean(document.archivedAt)).length,
    }
    const sectionItems = documents.filter((document) => {
      if (section === 'ARCHIVED') return Boolean(document.archivedAt)
      if (document.archivedAt) return false
      if (section === 'MINE') return document.isOwner
      if (section === 'SHARED') return !document.isOwner
      if (section === 'DRAFTS') return document.status === 'DRAFT'
      return true
    }).filter((document) => fileType === 'ALL' || document.fileType === fileType)
    sectionItems.sort((left, right) => {
      if (sort === 'NAME') return left.name.localeCompare(right.name, 'uk')
      if (sort === 'OWNER') {
        return left.ownerName.localeCompare(right.ownerName, 'uk') || left.name.localeCompare(right.name, 'uk')
      }
      return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
    })
    return { items: sectionItems, counts }
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
    const document = await this.prisma.document.findFirst({ where: { id: documentId, ownerId: principal.userId, companyId: { in: principal.allowedCompanyIds }, archivedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
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

  async addVersion(
    principal: AuthPrincipal,
    documentId: string,
    input: { fileId: string; changeSummary?: string; expectedVersion: number },
  ) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        companyId: { in: principal.allowedCompanyIds },
        archivedAt: null,
        ...(isGlobalAdmin(principal) ? {} : { ownerId: principal.userId }),
      },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!document) throw notFound()
    if (document.version !== input.expectedVersion) throw conflict()
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: input.fileId,
        companyId: document.companyId,
        ownerId: principal.userId,
        scanStatus: 'CLEAN',
      },
    })
    if (!file) throw badRequest('file_invalid')
    const nextVersion = (document.versions[0]?.version ?? 0) + 1
    const versionId = id('docv')
    await this.prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          version: nextVersion,
          fileId: file.id,
          createdBy: principal.userId,
          changeSummary: input.changeSummary?.trim() || `Версія ${nextVersion}`,
          status: 'DRAFT',
        },
      })
      await tx.document.update({
        where: { id: documentId },
        data: {
          currentVersionId: versionId,
          status: 'DRAFT',
          version: { increment: 1 },
        },
      })
      await tx.fileLink.create({
        data: {
          id: id('fln'),
          fileId: file.id,
          entityType: 'DOCUMENT',
          entityId: documentId,
          purpose: `VERSION_${nextVersion}`,
          aclMode: 'INHERIT',
        },
      })
    })
    return { id: versionId, version: nextVersion, documentVersion: input.expectedVersion + 1 }
  }

  async archive(principal: AuthPrincipal, documentId: string, expectedVersion: number) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: principal.allowedCompanyIds }, archivedAt: null },
      select: { id: true, companyId: true, version: true },
    })
    if (!document) throw notFound()
    if (document.version !== expectedVersion) throw conflict()
    const archivedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id },
        data: { archivedAt, version: { increment: 1 } },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: document.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'document.archived',
          entityType: 'DOCUMENT',
          entityId: document.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
    })
    return { archived: true, archivedAt: archivedAt.toISOString(), version: expectedVersion + 1 }
  }

  async restore(principal: AuthPrincipal, documentId: string, expectedVersion: number) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: principal.allowedCompanyIds }, archivedAt: { not: null } },
      select: { id: true, companyId: true, version: true },
    })
    if (!document) throw notFound()
    if (document.version !== expectedVersion) throw conflict()
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id },
        data: { archivedAt: null, version: { increment: 1 } },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: document.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'document.restored',
          entityType: 'DOCUMENT',
          entityId: document.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
    })
    return { restored: true, version: expectedVersion + 1 }
  }

  private fileType(mimeType: string | null): Exclude<DocumentFileType, 'ALL'> {
    if (mimeType?.startsWith('image/')) return 'IMAGE'
    if (mimeType === 'application/pdf'
      || mimeType === 'text/plain'
      || mimeType?.includes('wordprocessingml')) return 'DOCUMENT'
    return 'OTHER'
  }

  private async allowedDocumentIds(principal: AuthPrincipal): Promise<string[]> {
    if (isGlobalAdmin(principal)) {
      const documents = await this.prisma.document.findMany({
        where: { workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true },
      })
      return documents.map((document) => document.id)
    }
    const acl = await this.prisma.documentAcl.findMany({ where: { principalType: 'USER', principalId: principal.userId }, select: { documentId: true } })
    return acl.map((entry) => entry.documentId)
  }
}
