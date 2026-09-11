import { Injectable } from '@nestjs/common'
import type {
  DriveFileItem,
  DriveFolderItem,
  DriveListQuery,
  DriveListResult,
  DriveModifiedFilter,
} from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FilesService } from '../files/files.service.js'
import { DriveFoldersService } from './drive-folders.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

const RECENT_LIMIT = 50

function modifiedSince(filter: DriveModifiedFilter): Date | null {
  if (filter === 'ANY') return null
  const now = Date.now()
  const days = { TODAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 }[filter]
  return new Date(now - days * 24 * 60 * 60 * 1000)
}

function fileTypeOf(mimeType: string | null): DriveFileItem['fileType'] {
  if (mimeType?.startsWith('image/')) return 'IMAGE'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'text/plain' || mimeType?.includes('wordprocessingml')) return 'DOCUMENT'
  return 'OTHER'
}

@Injectable()
export class DriveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly folders: DriveFoldersService,
    private readonly sharing: DriveSharingService,
    private readonly files: FilesService,
  ) {}

  /** Saves a file the principal can already read (a chat attachment, say) onto their Drive. */
  async importFile(
    principal: AuthPrincipal,
    input: { fileId: string; name?: string; folderId?: string | null; companyId?: string },
  ) {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    if (input.folderId) {
      const folder = await this.prisma.driveFolder.findFirst({
        where: { id: input.folderId, companyId, trashedAt: null },
        select: { id: true },
      })
      if (!folder) throw badRequest('drive_folder_invalid')
      if (!await this.sharing.canEditFolder(principal, input.folderId)) throw forbidden()
    }
    const copy = await this.files.copyForPrincipal(principal, input.fileId, companyId)
    const documentId = id('doc')
    const versionId = id('docv')
    const name = (input.name?.trim() || copy.fileName.replace(/\.[^/.]+$/, '')).slice(0, 200)
    await this.prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          workspaceId: principal.workspaceId,
          companyId,
          number: `DOC-${Date.now().toString().slice(-7)}`,
          name,
          ownerId: principal.userId,
          status: 'DRAFT',
          currentVersionId: versionId,
          folderId: input.folderId ?? null,
        },
      })
      await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          version: 1,
          fileId: copy.id,
          createdBy: principal.userId,
          changeSummary: 'Збережено на Диск',
          status: 'DRAFT',
        },
      })
      await tx.fileLink.create({
        data: { id: id('fln'), fileId: copy.id, entityType: 'DOCUMENT', entityId: documentId, purpose: 'VERSION', aclMode: 'INHERIT' },
      })
    })
    await this.audit(principal, companyId, documentId, 'drive.file_imported')
    return { id: documentId, name, folderId: input.folderId ?? null, fileId: copy.id }
  }

  /** Prepares a Drive document for sending in chat by copying its current file to the principal. */
  async attachmentFromDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.readableDocument(principal, documentId)
    const version = await this.prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: 'desc' },
      select: { fileId: true },
    })
    if (!version) throw badRequest('drive_document_empty')
    return this.files.copyForPrincipal(principal, version.fileId, document.companyId)
  }

  private async readableDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: principal.allowedCompanyIds } },
      select: { id: true, companyId: true, ownerId: true, confidentiality: true },
    })
    if (!document) throw notFound()
    if (document.ownerId === principal.userId
      || isGlobalAdmin(principal)
      || document.confidentiality === 'GENERAL'
      || document.confidentiality === 'INTERNAL') return document
    const grants = await this.sharing.grantsFor(principal)
    if (!grants.roleOf('DOCUMENT', documentId)) throw notFound()
    return document
  }

  async list(principal: AuthPrincipal, query: DriveListQuery): Promise<DriveListResult> {
    const companyIds = this.scope.allowedCompanies(principal, query.company)
    const grants = await this.sharing.grantsFor(principal)
    const admin = isGlobalAdmin(principal)
    const since = modifiedSince(query.modified)
    const search = query.search?.trim()

    const folderRows = await this.prisma.driveFolder.findMany({
      where: {
        companyId: { in: companyIds },
        ...(search ? { name: { contains: search } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    })
    const documentRows = await this.prisma.document.findMany({
      where: {
        companyId: { in: companyIds },
        ...(search ? { name: { contains: search } } : {}),
        ...(admin ? {} : {
          OR: [
            { ownerId: principal.userId },
            { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
            { id: { in: [...grants.documentIds] } },
          ],
        }),
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { versions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const visibleFolders = folderRows.filter((folder) =>
      admin || folder.ownerId === principal.userId || grants.folderIds.has(folder.id))

    const ownerIds = new Set([
      ...visibleFolders.map((folder) => folder.ownerId),
      ...documentRows.map((document) => document.ownerId),
    ])
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...ownerIds] } },
      select: { id: true, displayName: true },
    })
    const ownerName = new Map(owners.map((owner) => [owner.id, owner.displayName]))

    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: documentRows.flatMap((row) => row.versions.map((version) => version.fileId)) } },
      select: { id: true, detectedMime: true, declaredMime: true, bytes: true },
    })
    const fileById = new Map(files.map((file) => [file.id, file]))

    const [folderShareCounts, documentShareCounts, childCounts] = await Promise.all([
      this.prisma.driveShare.groupBy({ by: ['targetId'], where: { targetType: 'FOLDER' }, _count: { targetId: true } }),
      this.prisma.driveShare.groupBy({ by: ['targetId'], where: { targetType: 'DOCUMENT' }, _count: { targetId: true } }),
      this.prisma.driveFolder.groupBy({ by: ['parentId'], where: { trashedAt: null }, _count: { parentId: true } }),
    ])
    const folderShares = new Map(folderShareCounts.map((row) => [row.targetId, row._count.targetId]))
    const documentShares = new Map(documentShareCounts.map((row) => [row.targetId, row._count.targetId]))
    const children = new Map(childCounts.filter((row) => row.parentId).map((row) => [row.parentId!, row._count.parentId]))

    const allFolders: DriveFolderItem[] = visibleFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      companyId: folder.companyId,
      ownerId: folder.ownerId,
      ownerName: ownerName.get(folder.ownerId) ?? 'Недоступний користувач',
      isOwner: folder.ownerId === principal.userId,
      sharedWithCount: folderShares.get(folder.id) ?? 0,
      childCount: children.get(folder.id) ?? 0,
      updatedAt: folder.updatedAt.toISOString(),
      trashedAt: folder.trashedAt?.toISOString() ?? null,
    }))

    const allFiles: DriveFileItem[] = documentRows.map((row) => {
      const file = row.versions[0] ? fileById.get(row.versions[0].fileId) : undefined
      const mimeType = file?.detectedMime ?? file?.declaredMime ?? null
      return {
        id: row.id,
        number: row.number,
        name: row.name,
        companyId: row.companyId,
        folderId: row.folderId,
        fileId: row.versions[0]?.fileId ?? null,
        mimeType,
        fileType: fileTypeOf(mimeType),
        sizeBytes: file?.bytes ?? null,
        ownerId: row.ownerId,
        ownerName: ownerName.get(row.ownerId) ?? 'Недоступний користувач',
        isOwner: row.ownerId === principal.userId,
        sharedWithCount: documentShares.get(row.id) ?? 0,
        version: row.version,
        versionCount: row._count.versions,
        updatedAt: row.updatedAt.toISOString(),
        trashedAt: row.archivedAt?.toISOString() ?? null,
      }
    })

    const counts = {
      MY_DRIVE: allFolders.filter((f) => !f.trashedAt && f.isOwner).length
        + allFiles.filter((f) => !f.trashedAt && f.isOwner).length,
      SHARED: allFolders.filter((f) => !f.trashedAt && !f.isOwner).length
        + allFiles.filter((f) => !f.trashedAt && !f.isOwner).length,
      RECENT: allFiles.filter((f) => !f.trashedAt).length,
      TRASH: allFolders.filter((f) => f.trashedAt).length + allFiles.filter((f) => f.trashedAt).length,
    }

    const currentFolderId = query.view === 'MY_DRIVE' ? query.folderId ?? null : null
    const matchesFilters = (item: { updatedAt: string; isOwner: boolean }) => {
      if (since && new Date(item.updatedAt) < since) return false
      if (query.people === 'ME' && !item.isOwner) return false
      if (query.people === 'OTHERS' && item.isOwner) return false
      return true
    }

    let folders = allFolders
    let filesOut = allFiles
    if (query.view === 'TRASH') {
      folders = folders.filter((folder) => folder.trashedAt)
      filesOut = filesOut.filter((file) => file.trashedAt)
    } else {
      folders = folders.filter((folder) => !folder.trashedAt)
      filesOut = filesOut.filter((file) => !file.trashedAt)
      if (query.view === 'MY_DRIVE') {
        // Browsing a folder is only meaningful when the search box is empty.
        if (!search) {
          folders = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
          filesOut = filesOut.filter((file) => (file.folderId ?? null) === currentFolderId)
        }
      } else if (query.view === 'SHARED') {
        folders = folders.filter((folder) => !folder.isOwner)
        filesOut = filesOut.filter((file) => !file.isOwner)
      } else if (query.view === 'RECENT') {
        folders = []
        filesOut = filesOut.slice(0, RECENT_LIMIT)
      }
    }

    folders = folders.filter(matchesFilters)
    filesOut = filesOut.filter(matchesFilters)
    if (query.type !== 'ALL') {
      if (query.type === 'FOLDER') filesOut = []
      else {
        folders = []
        filesOut = filesOut.filter((file) => file.fileType === query.type)
      }
    }

    const direction = query.direction === 'ASC' ? 1 : -1
    const compare = <T extends { name: string; ownerName: string; updatedAt: string }>(left: T, right: T): number => {
      if (query.sort === 'NAME') return left.name.localeCompare(right.name, 'uk') * direction
      if (query.sort === 'OWNER') return (left.ownerName.localeCompare(right.ownerName, 'uk') || left.name.localeCompare(right.name, 'uk')) * direction
      if (query.sort === 'SIZE') {
        const size = (item: T) => ('sizeBytes' in item ? Number((item as { sizeBytes: number | null }).sizeBytes ?? 0) : 0)
        return (size(left) - size(right)) * direction
      }
      return left.updatedAt.localeCompare(right.updatedAt) * direction
    }
    folders.sort(compare)
    filesOut.sort(compare)

    return {
      breadcrumbs: currentFolderId ? await this.folders.breadcrumbs(principal, currentFolderId) : [],
      folders,
      files: filesOut,
      counts,
    }
  }

  async moveDocument(principal: AuthPrincipal, documentId: string, folderId: string | null, expectedVersion: number) {
    const document = await this.editableDocument(principal, documentId)
    if (document.version !== expectedVersion) throw conflict()
    if (folderId) {
      const folder = await this.prisma.driveFolder.findFirst({
        where: { id: folderId, companyId: document.companyId, trashedAt: null },
        select: { id: true },
      })
      if (!folder) throw badRequest('drive_folder_invalid')
      if (!await this.sharing.canEditFolder(principal, folderId)) throw forbidden()
    }
    await this.prisma.document.update({
      where: { id: documentId },
      data: { folderId, version: { increment: 1 } },
    })
    await this.audit(principal, document.companyId, documentId, 'drive.document_moved')
    return { moved: true, folderId, version: expectedVersion + 1 }
  }

  async renameDocument(principal: AuthPrincipal, documentId: string, name: string, expectedVersion: number) {
    const document = await this.editableDocument(principal, documentId)
    if (document.version !== expectedVersion) throw conflict()
    await this.prisma.document.update({
      where: { id: documentId },
      data: { name: name.trim(), version: { increment: 1 } },
    })
    await this.audit(principal, document.companyId, documentId, 'drive.document_renamed')
    return { renamed: true, name: name.trim(), version: expectedVersion + 1 }
  }

  private async editableDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: principal.allowedCompanyIds } },
      select: { id: true, companyId: true, ownerId: true, version: true },
    })
    if (!document) throw notFound()
    if (document.ownerId === principal.userId || isGlobalAdmin(principal)) return document
    const grants = await this.sharing.grantsFor(principal)
    if (grants.roleOf('DOCUMENT', documentId) !== 'EDITOR') throw forbidden()
    return document
  }

  private async audit(principal: AuthPrincipal, companyId: string, documentId: string, action: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId,
        actorType: 'USER',
        actorId: principal.userId,
        action,
        entityType: 'DOCUMENT',
        entityId: documentId,
        result: 'SUCCESS',
        risk: 'NORMAL',
        correlationId: id('corr'),
      },
    })
  }
}
