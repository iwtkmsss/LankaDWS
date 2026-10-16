import { Injectable } from '@nestjs/common'
import type { DriveBreadcrumb } from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, forbidden, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

const MAX_DEPTH = 16

@Injectable()
export class DriveFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly sharing: DriveSharingService,
  ) {}

  async create(principal: AuthPrincipal, input: { name: string; parentId?: string | null }) {
    let companyId: string
    if (input.parentId) {
      const parent = await this.readable(principal, input.parentId)
      companyId = this.scope.assertCompany(principal, parent.companyId)
      if (!await this.sharing.canEditFolder(principal, parent.id)) throw forbidden()
      if (parent.trashedAt) throw badRequest('drive_folder_parent_trashed')
      if ((await this.breadcrumbs(principal, input.parentId)).length >= MAX_DEPTH) {
        throw badRequest('drive_folder_too_deep')
      }
    } else companyId = this.scope.assertCompany(principal, undefined)
    const folderId = id('dfol')
    await this.prisma.driveFolder.create({
      data: {
        id: folderId,
        workspaceId: principal.workspaceId,
        companyId,
        name: input.name.trim(),
        parentId: input.parentId ?? null,
        ownerId: principal.userId,
      },
    })
    await this.audit(principal, companyId, folderId, 'drive.folder_created')
    return this.detail(principal, folderId)
  }

  async rename(principal: AuthPrincipal, folderId: string, name: string) {
    await this.assertEditable(principal, folderId)
    await this.prisma.driveFolder.update({ where: { id: folderId }, data: { name: name.trim() } })
    const folder = await this.detail(principal, folderId)
    await this.audit(principal, folder.companyId, folderId, 'drive.folder_renamed')
    return folder
  }

  async move(principal: AuthPrincipal, folderId: string, parentId: string | null) {
    await this.assertEditable(principal, folderId)
    const folder = await this.readable(principal, folderId)
    if (parentId) {
      if (parentId === folderId) throw badRequest('drive_folder_cycle')
      const parent = await this.readable(principal, parentId)
      if (!await this.sharing.canEditFolder(principal, parentId)) throw forbidden()
      if (parent.trashedAt) throw badRequest('drive_folder_parent_trashed')
      const subtree = await this.sharing.expandSubtree(principal, [folderId])
      if (subtree.has(parentId)) throw badRequest('drive_folder_cycle')
    }
    await this.prisma.driveFolder.update({ where: { id: folderId }, data: { parentId } })
    await this.audit(principal, folder.companyId, folderId, 'drive.folder_moved')
    return this.detail(principal, folderId)
  }

  /** Trashing a folder trashes everything beneath it, the way Drive does. */
  async trash(principal: AuthPrincipal, folderId: string) {
    await this.assertEditable(principal, folderId)
    const folder = await this.readable(principal, folderId)
    const subtree = [...await this.sharing.expandSubtree(principal, [folderId])]
    const trashedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.driveFolder.updateMany({ where: { id: { in: subtree } }, data: { trashedAt } })
      await tx.document.updateMany({ where: { folderId: { in: subtree }, archivedAt: null }, data: { archivedAt: trashedAt } })
    })
    await this.audit(principal, folder.companyId, folderId, 'drive.folder_trashed')
    return { trashed: true, folders: subtree.length, trashedAt: trashedAt.toISOString() }
  }

  async restore(principal: AuthPrincipal, folderId: string) {
    await this.assertEditable(principal, folderId)
    const folder = await this.readable(principal, folderId)
    const subtree = [...await this.sharing.expandSubtree(principal, [folderId])]
    await this.prisma.$transaction(async (tx) => {
      await tx.driveFolder.updateMany({ where: { id: { in: subtree } }, data: { trashedAt: null } })
      await tx.document.updateMany({ where: { folderId: { in: subtree } }, data: { archivedAt: null } })
    })
    await this.audit(principal, folder.companyId, folderId, 'drive.folder_restored')
    return { restored: true, folders: subtree.length }
  }

  async breadcrumbs(principal: AuthPrincipal, folderId: string | null, includeAll = false): Promise<DriveBreadcrumb[]> {
    const trail: DriveBreadcrumb[] = []
    let cursor = folderId
    const seen = new Set<string>()
    const grants = await this.sharing.grantsFor(principal)
    while (cursor && trail.length < MAX_DEPTH && !seen.has(cursor)) {
      seen.add(cursor)
      const folder = await this.prisma.driveFolder.findFirst({
        where: { id: cursor, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true, name: true, parentId: true, ownerId: true },
      })
      if (!folder) break
      if (!(includeAll && isGlobalAdmin(principal)) && folder.ownerId !== principal.userId && !grants.folderIds.has(folder.id)) break
      trail.unshift({ id: folder.id, name: folder.name })
      cursor = folder.parentId
    }
    return trail
  }

  async detail(principal: AuthPrincipal, folderId: string) {
    const folder = await this.readable(principal, folderId)
    const grants = await this.sharing.grantsFor(principal)
    const [owner, childCount, fileCount, shareCount, sizes] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: folder.ownerId }, select: { displayName: true } }),
      this.prisma.driveFolder.count({ where: { parentId: folder.id, trashedAt: null } }),
      this.prisma.document.count({
        where: {
          folderId: folder.id,
          companyId: { in: principal.allowedCompanyIds },
          archivedAt: null,
          ...(isGlobalAdmin(principal) ? {} : {
            OR: [
              { ownerId: principal.userId },
              { id: { in: [...grants.documentIds] } },
            ],
          }),
        },
      }),
      this.prisma.driveShare.count({ where: { targetType: 'FOLDER', targetId: folder.id } }),
      this.sizes(principal, [folder.id]),
    ])
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      companyId: folder.companyId,
      ownerId: folder.ownerId,
      ownerName: owner?.displayName ?? 'Недоступний користувач',
      isOwner: folder.ownerId === principal.userId,
      accessRole: folder.ownerId === principal.userId || isGlobalAdmin(principal) || grants.roleOf?.('FOLDER', folder.id) === 'EDITOR' ? 'EDITOR' as const : 'VIEWER' as const,
      isShared: shareCount > 0 || grants.folderIds.has(folder.id),
      sharedWithCount: shareCount,
      childCount: childCount + fileCount,
      sizeBytes: sizes.get(folder.id) ?? null,
      updatedAt: folder.updatedAt.toISOString(),
      trashedAt: folder.trashedAt?.toISOString() ?? null,
    }
  }

  /** Counts document files through readable, active descendants, independently of UI filters. */
  async sizes(principal: AuthPrincipal, folderIds: string[], includeAll = false): Promise<Map<string, number | null>> {
    if (folderIds.length === 0) return new Map()
    const grants = await this.sharing.grantsFor(principal)
    const admin = includeAll && isGlobalAdmin(principal)
    const folderRows = await this.prisma.driveFolder.findMany({
      where: {
        companyId: { in: principal.allowedCompanyIds }, trashedAt: null,
        ...(admin ? {} : { OR: [{ ownerId: principal.userId }, { id: { in: [...grants.folderIds] } }] }),
      },
      select: { id: true, parentId: true },
    })
    const parents = new Map(folderRows.map((folder) => [folder.id, folder.parentId]))
    const wanted = new Set(folderIds)
    const ancestors = new Map<string, string[]>()
    for (const folder of folderRows) {
      const path: string[] = []
      const seen = new Set<string>()
      let cursor: string | null = folder.id
      while (cursor && parents.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor)
        if (wanted.has(cursor)) path.push(cursor)
        cursor = parents.get(cursor) ?? null
      }
      if (path.length > 0) ancestors.set(folder.id, path)
    }
    const sizes = new Map<string, number | null>(folderIds.map((folderId) => [folderId, parents.has(folderId) ? 0 : null]))
    if (ancestors.size === 0) return sizes
    const documents = await this.prisma.document.findMany({
      where: {
        folderId: { in: [...ancestors.keys()] }, archivedAt: null,
        companyId: { in: principal.allowedCompanyIds },
        ...(admin ? {} : { OR: [
          { ownerId: principal.userId },
          { id: { in: [...grants.documentIds] } },
        ] }),
      },
      select: { folderId: true, fileId: true },
    })
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: documents.flatMap((document) => document.fileId ? [document.fileId] : []) } },
      select: { id: true, bytes: true },
    })
    const bytes = new Map(files.map((file) => [file.id, file.bytes]))
    for (const document of documents) {
      const fileId = document.fileId
      const size = fileId ? bytes.get(fileId) ?? null : 0
      for (const folderId of ancestors.get(document.folderId!) ?? []) {
        const total = sizes.get(folderId)
        sizes.set(folderId, total === null || size === null ? null : (total ?? 0) + size)
      }
    }
    return sizes
  }

  private async readable(principal: AuthPrincipal, folderId: string) {
    const folder = await this.prisma.driveFolder.findFirst({
      where: { id: folderId, companyId: { in: principal.allowedCompanyIds } },
    })
    if (!folder) throw notFound()
    if (folder.ownerId === principal.userId || isGlobalAdmin(principal)) return folder
    const grants = await this.sharing.grantsFor(principal)
    if (!grants.folderIds.has(folderId)) throw notFound()
    return folder
  }

  private async assertEditable(principal: AuthPrincipal, folderId: string): Promise<void> {
    await this.readable(principal, folderId)
    if (!await this.sharing.canEditFolder(principal, folderId)) throw forbidden()
  }

  private async audit(principal: AuthPrincipal, companyId: string, folderId: string, action: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId,
        actorType: 'USER',
        actorId: principal.userId,
        action,
        entityType: 'FOLDER',
        entityId: folderId,
        result: 'SUCCESS',
        risk: 'NORMAL',
        correlationId: id('corr'),
      },
    })
  }
}
