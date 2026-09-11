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

  async create(principal: AuthPrincipal, input: { companyId?: string; name: string; parentId?: string | null }) {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    if (input.parentId) {
      const parent = await this.readable(principal, input.parentId)
      if (parent.companyId !== companyId) throw badRequest('drive_folder_company_mismatch')
      if (parent.trashedAt) throw badRequest('drive_folder_parent_trashed')
      if ((await this.breadcrumbs(principal, input.parentId)).length >= MAX_DEPTH) {
        throw badRequest('drive_folder_too_deep')
      }
    }
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
      if (parent.companyId !== folder.companyId) throw badRequest('drive_folder_company_mismatch')
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

  async breadcrumbs(principal: AuthPrincipal, folderId: string | null): Promise<DriveBreadcrumb[]> {
    const trail: DriveBreadcrumb[] = []
    let cursor = folderId
    const seen = new Set<string>()
    while (cursor && trail.length < MAX_DEPTH && !seen.has(cursor)) {
      seen.add(cursor)
      const folder = await this.prisma.driveFolder.findFirst({
        where: { id: cursor, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true, name: true, parentId: true },
      })
      if (!folder) break
      trail.unshift({ id: folder.id, name: folder.name })
      cursor = folder.parentId
    }
    return trail
  }

  async detail(principal: AuthPrincipal, folderId: string) {
    const folder = await this.readable(principal, folderId)
    const [owner, childCount, shareCount] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: folder.ownerId }, select: { displayName: true } }),
      this.prisma.driveFolder.count({ where: { parentId: folder.id, trashedAt: null } }),
      this.prisma.driveShare.count({ where: { targetType: 'FOLDER', targetId: folder.id } }),
    ])
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      companyId: folder.companyId,
      ownerId: folder.ownerId,
      ownerName: owner?.displayName ?? 'Недоступний користувач',
      isOwner: folder.ownerId === principal.userId,
      sharedWithCount: shareCount,
      childCount,
      updatedAt: folder.updatedAt.toISOString(),
      trashedAt: folder.trashedAt?.toISOString() ?? null,
    }
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
