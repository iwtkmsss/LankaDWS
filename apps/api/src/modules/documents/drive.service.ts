import { Injectable } from '@nestjs/common'
import type {
  DriveFileItem,
  DriveFolderItem,
  DriveListQuery,
  DriveListResult,
  DriveModifiedFilter,
  DriveOwnersQuery,
  DriveOwnersResult,
  DriveDestinationsQuery,
  DriveDestinationsResult,
  DrivePickerQuery,
  DrivePickerResult,
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
    input: { fileId: string; name?: string; folderId?: string | null },
  ) {
    const companyId = this.scope.assertCompany(principal, undefined)
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
          fileId: copy.id,
          folderId: input.folderId ?? null,
        },
      })
      await tx.fileLink.create({
        data: { id: id('fln'), fileId: copy.id, entityType: 'DOCUMENT', entityId: documentId, purpose: 'CONTENT', aclMode: 'INHERIT' },
      })
    })
    await this.audit(principal, companyId, documentId, 'drive.file_imported')
    return { id: documentId, name, folderId: input.folderId ?? null, fileId: copy.id }
  }

  /** Prepares a Drive document for sending in chat by copying its current file to the principal. */
  async attachmentFromDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.readableDocument(principal, documentId)
    if (!document.fileId) throw badRequest('drive_document_empty')
    return this.files.copyForPrincipal(principal, document.fileId, document.companyId)
  }

  private async readableDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, archivedAt: null },
      select: { id: true, companyId: true, ownerId: true, confidentiality: true, fileId: true },
    })
    if (!document) throw notFound()
    if (document.ownerId === principal.userId || isGlobalAdmin(principal)) return document
    const grants = await this.sharing.grantsFor(principal)
    if (!grants.roleOf('DOCUMENT', documentId)) throw notFound()
    return document
  }

  async picker(principal: AuthPrincipal, query: DrivePickerQuery): Promise<DrivePickerResult> {
    const grants = await this.sharing.grantsFor(principal)
    const folderAccess = { OR: [
      { ownerId: principal.userId }, { id: { in: [...grants.folderIds] } },
    ] }
    if (query.folderId && !query.search) {
      const parent = await this.prisma.driveFolder.findFirst({
        where: { id: query.folderId, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null, ...folderAccess },
        select: { id: true },
      })
      if (!parent) throw notFound()
    }
    const folderCursor = query.cursor?.startsWith('folder:') ? query.cursor.slice(7) : undefined
    const documentCursor = folderCursor ? undefined : query.cursor
    const folderRows = !query.search && !documentCursor ? await this.prisma.driveFolder.findMany({
      where: { workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null, ...folderAccess,
        ...(query.folderId ? { parentId: query.folderId } : { AND: [{ OR: [{ parentId: null }, { parent: { is: { NOT: folderAccess } } }] }] }),
      },
      select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      ...(folderCursor ? { cursor: { id: folderCursor }, skip: 1 } : {}),
    }) : []
    const folders = folderRows.slice(0, query.limit)
    if (folderRows.length > query.limit) return { folders, items: [], nextCursor: `folder:${folders.at(-1)!.id}` }
    const fileLimit = query.limit - folders.length
    const documents = await this.prisma.document.findMany({
      where: {
        workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, archivedAt: null, fileId: { not: null },
        ...(query.search ? { name: { contains: query.search } } : {}),
        ...(!query.search ? query.folderId ? { folderId: query.folderId }
          : { AND: [{ OR: [{ folderId: null }, { folder: { is: { NOT: folderAccess } } }] }] } : {}),
        OR: [
          { ownerId: principal.userId },
          { id: { in: [...grants.documentIds] } },
        ],
      },
      select: { id: true, name: true, fileId: true, folderId: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: fileLimit + 1,
      ...(documentCursor ? { cursor: { id: documentCursor }, skip: 1 } : {}),
    })
    const page = documents.slice(0, fileLimit)
    const files = await this.prisma.fileObject.findMany({
      where: { workspaceId: principal.workspaceId, id: { in: page.flatMap((document) => document.fileId ? [document.fileId] : []) } },
      select: { id: true, detectedMime: true, declaredMime: true, bytes: true },
    })
    const metadata = new Map(files.map((file) => [file.id, file]))
    const ancestors = new Map<string, { name: string; parentId: string | null }>()
    if (query.search) {
      let frontier = [...new Set(page.flatMap((document) => document.folderId ? [document.folderId] : []))]
      for (let depth = 0; frontier.length && depth < 16; depth++) {
        const rows = await this.prisma.driveFolder.findMany({
          where: { id: { in: frontier }, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null, ...folderAccess },
          select: { id: true, name: true, parentId: true },
        })
        for (const row of rows) ancestors.set(row.id, row)
        frontier = [...new Set(rows.flatMap((row) => row.parentId && !ancestors.has(row.parentId) ? [row.parentId] : []))]
      }
    }
    return {
      folders,
      items: page.map((document) => {
        const file = metadata.get(document.fileId!)
        const folderPath: string[] = []
        let cursor = document.folderId
        const seen = new Set<string>()
        while (cursor && ancestors.has(cursor) && !seen.has(cursor)) {
          seen.add(cursor)
          const parent = ancestors.get(cursor)!
          folderPath.unshift(parent.name)
          cursor = parent.parentId
        }
        folderPath.unshift(cursor ? 'Спільні файли' : 'Мій диск')
        return { id: document.id, name: document.name, fileType: fileTypeOf(file?.detectedMime ?? file?.declaredMime ?? null), sizeBytes: file?.bytes ?? null,
          ...(query.search ? { folderPath } : {}),
        }
      }),
      nextCursor: documents.length > fileLimit ? page.at(-1)?.id ?? `folder:${folders.at(-1)!.id}` : null,
    }
  }

  async destinations(principal: AuthPrincipal, query: DriveDestinationsQuery): Promise<DriveDestinationsResult> {
    const source = query.targetType === 'DOCUMENT'
      ? await this.editableDocument(principal, query.targetId)
      : await this.prisma.driveFolder.findFirst({
        where: { id: query.targetId, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null },
        select: { id: true, companyId: true, parentId: true },
      })
    if (!source) throw notFound()
    if (query.targetType === 'FOLDER' && !await this.sharing.canEditFolder(principal, query.targetId)) throw forbidden()
    const grants = await this.sharing.grantsFor(principal)
    const editableIds = [...grants.folderIds].filter((folderId) => grants.roleOf('FOLDER', folderId) === 'EDITOR')
    const excluded = query.targetType === 'FOLDER' ? [...await this.sharing.expandSubtree(principal, [query.targetId])] : []
    const eligible = {
      workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null,
      ...(excluded.length ? { id: { notIn: excluded } } : {}),
      ...(isGlobalAdmin(principal) ? {} : { OR: [{ ownerId: principal.userId }, { id: { in: editableIds } }] }),
    }
    if (query.folderId && !await this.prisma.driveFolder.findFirst({ where: { AND: [eligible, { id: query.folderId }] }, select: { id: true } })) throw notFound()
    const rows = await this.prisma.driveFolder.findMany({
      where: { AND: [eligible, query.folderId ? { parentId: query.folderId } : { OR: [{ parentId: null }, { parent: { is: { NOT: eligible } } }] }] },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, query.limit)
    const children = page.length ? await this.prisma.driveFolder.groupBy({
      by: ['parentId'], where: { AND: [eligible, { parentId: { in: page.map((folder) => folder.id) } }] }, _count: { _all: true },
    }) : []
    const parents = new Set(children.map((row) => row.parentId))
    const currentParent = 'folderId' in source ? source.folderId : source.parentId
    return { items: page.filter((folder) => folder.id !== currentParent || parents.has(folder.id)).map((folder) => ({ ...folder, hasChildren: parents.has(folder.id) })), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null }
  }

  async owners(principal: AuthPrincipal, query: DriveOwnersQuery): Promise<DriveOwnersResult> {
    if (!isGlobalAdmin(principal)) throw forbidden()
    const companyIds = this.scope.allowedCompanies(principal)
    const [folders, documents] = await Promise.all([
      this.prisma.driveFolder.groupBy({ by: ['ownerId'], where: { workspaceId: principal.workspaceId, companyId: { in: companyIds }, trashedAt: null }, _count: { _all: true } }),
      this.prisma.document.groupBy({ by: ['ownerId'], where: { workspaceId: principal.workspaceId, companyId: { in: companyIds }, archivedAt: null }, _count: { _all: true } }),
    ])
    const counts = new Map<string, number>()
    for (const row of [...folders, ...documents]) counts.set(row.ownerId, (counts.get(row.ownerId) ?? 0) + row._count._all)
    const search = query.search?.replace(/^@/, '').trim()
    const owners = await this.prisma.user.findMany({
      where: {
        workspaceId: principal.workspaceId,
        id: { in: [...counts.keys()] },
        ...(search ? { OR: [{ displayName: { contains: search } }, { username: { contains: search } }] } : {}),
      },
      select: { id: true, displayName: true, username: true },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const page = owners.slice(0, query.limit)
    return { items: page.map((owner) => ({ ...owner, itemCount: counts.get(owner.id) ?? 0 })), nextCursor: owners.length > query.limit ? page.at(-1)!.id : null }
  }

  async list(principal: AuthPrincipal, query: DriveListQuery): Promise<DriveListResult> {
    if ((query.view === 'USERS' || query.ownerId) && !isGlobalAdmin(principal)) throw forbidden()
    if (query.view === 'USERS' && !query.ownerId) throw badRequest('drive_owner_required')
    if (query.ownerId && query.view !== 'USERS') throw badRequest('drive_query_invalid')
    const selectedOwner = query.ownerId ? await this.prisma.user.findFirst({
      where: { id: query.ownerId, workspaceId: principal.workspaceId }, select: { id: true, displayName: true, username: true },
    }) : null
    if (query.ownerId && !selectedOwner) throw notFound()
    const companyIds = this.scope.allowedCompanies(principal)
    const grants = await this.sharing.grantsFor(principal)
    const admin = isGlobalAdmin(principal)
    const browseAll = admin && query.view === 'USERS'
    const since = modifiedSince(query.modified)
    const search = query.search?.trim()
    const ownerFilter = query.ownerId ? { ownerId: query.ownerId } : {}
    const documentAccess = browseAll ? {} : {
      OR: [
        { ownerId: principal.userId },
        { id: { in: [...grants.documentIds] } },
      ],
    }
    const folderAccess = browseAll ? {} : { OR: [
      { ownerId: principal.userId }, { id: { in: [...grants.folderIds] } },
    ] }

    const folderRows = await this.prisma.driveFolder.findMany({
      where: {
        companyId: { in: companyIds },
        ...ownerFilter,
        ...folderAccess,
        ...(search ? { name: { contains: search } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    })
    const documentRows = await this.prisma.document.findMany({
      where: {
        companyId: { in: companyIds },
        ...ownerFilter,
        ...(search ? { name: { contains: search } } : {}),
        ...documentAccess,
      },
      orderBy: { updatedAt: 'desc' },
    })

    const visibleFolders = folderRows.filter((folder) =>
      browseAll || folder.ownerId === principal.userId || grants.folderIds.has(folder.id))
    if (query.folderId && !search && !visibleFolders.some((folder) => folder.id === query.folderId && !folder.trashedAt)) throw notFound()

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
      where: { id: { in: documentRows.flatMap((row) => row.fileId ? [row.fileId] : []) } },
      select: { id: true, safeFilename: true, detectedMime: true, declaredMime: true, bytes: true },
    })
    const fileById = new Map(files.map((file) => [file.id, file]))

    const [folderShareCounts, documentShareCounts, childCounts, childFileCounts] = await Promise.all([
      this.prisma.driveShare.groupBy({ by: ['targetId'], where: { targetType: 'FOLDER' }, _count: { targetId: true } }),
      this.prisma.driveShare.groupBy({ by: ['targetId'], where: { targetType: 'DOCUMENT' }, _count: { targetId: true } }),
      this.prisma.driveFolder.groupBy({ by: ['parentId'], where: {
        companyId: { in: companyIds }, trashedAt: null, parentId: { in: visibleFolders.map((folder) => folder.id) }, ...folderAccess,
      }, _count: { parentId: true } }),
      this.prisma.document.groupBy({
        by: ['folderId'],
        where: {
          companyId: { in: companyIds },
          folderId: { in: visibleFolders.map((folder) => folder.id) },
          archivedAt: null,
          ...documentAccess,
        },
        _count: { folderId: true },
      }),
    ])
    const folderShares = new Map(folderShareCounts.map((row) => [row.targetId, row._count.targetId]))
    const documentShares = new Map(documentShareCounts.map((row) => [row.targetId, row._count.targetId]))
    const sharedFolders = new Set(folderShareCounts.filter((row) => row._count.targetId > 0).map((row) => row.targetId))
    const childrenByParent = new Map<string, string[]>()
    for (const folder of folderRows) {
      if (!folder.parentId) continue
      const siblings = childrenByParent.get(folder.parentId) ?? []
      siblings.push(folder.id)
      childrenByParent.set(folder.parentId, siblings)
    }
    const sharedQueue = [...sharedFolders]
    for (let index = 0; index < sharedQueue.length; index += 1) {
      for (const childId of childrenByParent.get(sharedQueue[index]) ?? []) {
        if (sharedFolders.has(childId)) continue
        sharedFolders.add(childId)
        sharedQueue.push(childId)
      }
    }
    const children = new Map(childCounts.filter((row) => row.parentId).map((row) => [row.parentId!, row._count.parentId]))
    for (const row of childFileCounts) {
      if (row.folderId) children.set(row.folderId, (children.get(row.folderId) ?? 0) + row._count.folderId)
    }
    const folderSizes = await this.folders.sizes(principal, visibleFolders.map((folder) => folder.id), browseAll)

    const allFolders: DriveFolderItem[] = visibleFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      companyId: folder.companyId,
      ownerId: folder.ownerId,
      ownerName: ownerName.get(folder.ownerId) ?? 'Недоступний користувач',
      isOwner: folder.ownerId === principal.userId,
      accessRole: folder.ownerId === principal.userId || admin || grants.roleOf?.('FOLDER', folder.id) === 'EDITOR' ? 'EDITOR' : 'VIEWER',
      isShared: sharedFolders.has(folder.id) || grants.folderIds.has(folder.id),
      sharedWithCount: folderShares.get(folder.id) ?? 0,
      childCount: children.get(folder.id) ?? 0,
      sizeBytes: folderSizes.get(folder.id) ?? null,
      updatedAt: folder.updatedAt.toISOString(),
      trashedAt: folder.trashedAt?.toISOString() ?? null,
    }))

    const allFiles: DriveFileItem[] = documentRows.map((row) => {
      const file = row.fileId ? fileById.get(row.fileId) : undefined
      const mimeType = file?.detectedMime ?? file?.declaredMime ?? null
      return {
        id: row.id,
        number: row.number,
        name: row.name,
        companyId: row.companyId,
        folderId: row.folderId,
        fileId: row.fileId,
        mimeType,
        extension: file?.safeFilename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? null,
        fileType: fileTypeOf(mimeType),
        sizeBytes: file?.bytes ?? null,
        ownerId: row.ownerId,
        ownerName: ownerName.get(row.ownerId) ?? 'Недоступний користувач',
        isOwner: row.ownerId === principal.userId,
        accessRole: row.ownerId === principal.userId || admin || grants.roleOf?.('DOCUMENT', row.id) === 'EDITOR' ? 'EDITOR' : 'VIEWER',
        isShared: (documentShares.get(row.id) ?? 0) > 0 || Boolean(row.folderId && sharedFolders.has(row.folderId)) || grants.documentIds.has(row.id),
        sharedWithCount: documentShares.get(row.id) ?? 0,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
        trashedAt: row.archivedAt?.toISOString() ?? null,
      }
    })

    const counts = {
      MY_DRIVE: allFiles.filter((f) => !f.trashedAt).length,
      SHARED: allFiles.filter((f) => !f.trashedAt && !f.isOwner).length,
      RECENT: allFiles.filter((f) => !f.trashedAt).length,
      TRASH: allFiles.filter((f) => f.trashedAt).length,
    }

    const currentFolderId = query.view === 'MY_DRIVE' || query.view === 'USERS' ? query.folderId ?? null : null
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
      if (query.view === 'MY_DRIVE' || query.view === 'USERS') {
        // Browsing a folder is only meaningful when the search box is empty.
        if (!search) {
          const ownedFolderIds = new Set(allFolders.map((folder) => folder.id))
          const parentMatches = (parentId: string | null) => parentId === currentFolderId
            || (!currentFolderId && (!parentId || !ownedFolderIds.has(parentId)))
          folders = folders.filter((folder) => parentMatches(folder.parentId))
          filesOut = filesOut.filter((file) => parentMatches(file.folderId))
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
      owner: selectedOwner,
      breadcrumbs: currentFolderId ? await this.folders.breadcrumbs(principal, currentFolderId, browseAll) : [],
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
        where: { id: folderId, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, trashedAt: null },
        select: { id: true },
      })
      if (!folder) throw badRequest('drive_folder_invalid')
      if (!await this.sharing.canEditFolder(principal, folderId)) throw forbidden()
    }
    await this.prisma.document.update({
      where: { id: documentId },
      data: { folderId, version: { increment: 1 } },
      select: { id: true },
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
      select: { id: true, companyId: true, ownerId: true, version: true, folderId: true },
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
