import { Injectable } from '@nestjs/common'
import type { DriveShareRole, DriveShareTargetType } from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, forbidden, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

interface PrincipalKey {
  principalType: 'USER' | 'GROUP'
  principalId: string
}

export interface DriveGrants {
  folderIds: Set<string>
  documentIds: Set<string>
  roleOf: (targetType: DriveShareTargetType, targetId: string) => DriveShareRole | null
}

function strongest(left: DriveShareRole | undefined, right: DriveShareRole): DriveShareRole {
  return left === 'EDITOR' || right === 'EDITOR' ? 'EDITOR' : 'VIEWER'
}

@Injectable()
export class DriveSharingService {
  constructor(private readonly prisma: PrismaService) {}

  async principalKeys(principal: AuthPrincipal): Promise<PrincipalKey[]> {
    const memberships = await this.prisma.groupMember.findMany({
      where: {
        userId: principal.userId,
        leftAt: null,
        group: { companyId: { in: principal.allowedCompanyIds }, status: 'ACTIVE' },
      },
      select: { groupId: true },
    })
    return [
      { principalType: 'USER', principalId: principal.userId },
      ...memberships.map((membership) => ({ principalType: 'GROUP' as const, principalId: membership.groupId })),
    ]
  }

  /**
   * A folder share reaches everything beneath it, so shared folder ids are expanded
   * over the whole subtree before the documents inside them are collected.
   */
  async grantsFor(principal: AuthPrincipal): Promise<DriveGrants> {
    const keys = await this.principalKeys(principal)
    const shares = await this.prisma.driveShare.findMany({
      where: {
        workspaceId: principal.workspaceId,
        OR: keys.map((key) => ({ principalType: key.principalType, principalId: key.principalId })),
      },
      select: { targetType: true, targetId: true, role: true },
    })

    const roles = new Map<string, DriveShareRole>()
    const record = (targetType: string, targetId: string, role: DriveShareRole) => {
      const key = `${targetType}:${targetId}`
      roles.set(key, strongest(roles.get(key), role))
    }
    for (const share of shares) record(share.targetType, share.targetId, share.role as DriveShareRole)

    const folderIds = await this.expandSubtree(
      principal,
      shares.filter((share) => share.targetType === 'FOLDER').map((share) => share.targetId),
    )
    for (const folderId of folderIds) {
      if (!roles.has(`FOLDER:${folderId}`)) record('FOLDER', folderId, 'VIEWER')
    }

    const documentIds = new Set(
      shares.filter((share) => share.targetType === 'DOCUMENT').map((share) => share.targetId),
    )
    if (folderIds.size > 0) {
      const inherited = await this.prisma.document.findMany({
        where: { folderId: { in: [...folderIds] }, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true, folderId: true },
      })
      for (const document of inherited) {
        documentIds.add(document.id)
        const folderRole = roles.get(`FOLDER:${document.folderId}`) ?? 'VIEWER'
        record('DOCUMENT', document.id, folderRole)
      }
    }

    return {
      folderIds,
      documentIds,
      roleOf: (targetType, targetId) => roles.get(`${targetType}:${targetId}`) ?? null,
    }
  }

  async expandSubtree(principal: AuthPrincipal, rootIds: string[]): Promise<Set<string>> {
    const reached = new Set<string>()
    let frontier = rootIds.filter((value) => value.length > 0)
    while (frontier.length > 0) {
      const fresh = frontier.filter((folderId) => !reached.has(folderId))
      for (const folderId of fresh) reached.add(folderId)
      if (fresh.length === 0) break
      const children = await this.prisma.driveFolder.findMany({
        where: { parentId: { in: fresh }, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true },
      })
      frontier = children.map((child) => child.id)
    }
    return reached
  }

  async canEditFolder(principal: AuthPrincipal, folderId: string): Promise<boolean> {
    if (isGlobalAdmin(principal)) return true
    const folder = await this.prisma.driveFolder.findFirst({
      where: { id: folderId, companyId: { in: principal.allowedCompanyIds } },
      select: { ownerId: true },
    })
    if (!folder) return false
    if (folder.ownerId === principal.userId) return true
    const grants = await this.grantsFor(principal)
    return grants.roleOf('FOLDER', folderId) === 'EDITOR'
  }

  async list(principal: AuthPrincipal, targetType: DriveShareTargetType, targetId: string) {
    await this.assertTargetVisible(principal, targetType, targetId)
    const shares = await this.prisma.driveShare.findMany({
      where: { workspaceId: principal.workspaceId, targetType, targetId },
      orderBy: { createdAt: 'asc' },
    })
    const userIds = shares.filter((share) => share.principalType === 'USER').map((share) => share.principalId)
    const groupIds = shares.filter((share) => share.principalType === 'GROUP').map((share) => share.principalId)
    const [users, groups] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
      this.prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }),
    ])
    const nameById = new Map<string, string>([
      ...users.map((user) => [user.id, user.displayName] as const),
      ...groups.map((group) => [group.id, group.name] as const),
    ])
    return shares.map((share) => ({
      id: share.id,
      targetType: share.targetType as DriveShareTargetType,
      targetId: share.targetId,
      principalType: share.principalType as 'USER' | 'GROUP',
      principalId: share.principalId,
      principalName: nameById.get(share.principalId) ?? 'Недоступний принципал',
      role: share.role as DriveShareRole,
      inherited: false,
      createdAt: share.createdAt.toISOString(),
    }))
  }

  async create(
    principal: AuthPrincipal,
    input: { targetType: DriveShareTargetType; targetId: string; principalType: 'USER' | 'GROUP'; principalId: string; role: DriveShareRole },
  ) {
    await this.assertTargetOwned(principal, input.targetType, input.targetId)
    if (input.principalType === 'USER' && input.principalId === principal.userId) {
      throw badRequest('drive_share_self')
    }
    const exists = input.principalType === 'USER'
      ? await this.prisma.user.findFirst({ where: { id: input.principalId, workspaceId: principal.workspaceId, isActive: true }, select: { id: true } })
      : await this.prisma.group.findFirst({ where: { id: input.principalId, companyId: { in: principal.allowedCompanyIds }, status: 'ACTIVE' }, select: { id: true } })
    if (!exists) throw badRequest('drive_share_principal_invalid')

    const shareId = id('drsh')
    await this.prisma.driveShare.upsert({
      where: {
        targetType_targetId_principalType_principalId: {
          targetType: input.targetType,
          targetId: input.targetId,
          principalType: input.principalType,
          principalId: input.principalId,
        },
      },
      create: {
        id: shareId,
        workspaceId: principal.workspaceId,
        targetType: input.targetType,
        targetId: input.targetId,
        principalType: input.principalType,
        principalId: input.principalId,
        role: input.role,
        createdBy: principal.userId,
      },
      update: { role: input.role },
    })
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId: await this.companyOf(principal, input.targetType, input.targetId),
        actorType: 'USER',
        actorId: principal.userId,
        action: 'drive.shared',
        entityType: input.targetType,
        entityId: input.targetId,
        result: 'SUCCESS',
        risk: 'HIGH',
        safeDiffJson: JSON.stringify({ principalType: input.principalType, role: input.role }),
        correlationId: id('corr'),
      },
    })
    return this.list(principal, input.targetType, input.targetId)
  }

  async revoke(principal: AuthPrincipal, shareId: string) {
    const share = await this.prisma.driveShare.findFirst({
      where: { id: shareId, workspaceId: principal.workspaceId },
    })
    if (!share) throw notFound()
    await this.assertTargetOwned(principal, share.targetType as DriveShareTargetType, share.targetId)
    await this.prisma.driveShare.delete({ where: { id: shareId } })
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId: await this.companyOf(principal, share.targetType as DriveShareTargetType, share.targetId),
        actorType: 'USER',
        actorId: principal.userId,
        action: 'drive.share_revoked',
        entityType: share.targetType,
        entityId: share.targetId,
        result: 'SUCCESS',
        risk: 'HIGH',
        correlationId: id('corr'),
      },
    })
    return this.list(principal, share.targetType as DriveShareTargetType, share.targetId)
  }

  private async companyOf(principal: AuthPrincipal, targetType: DriveShareTargetType, targetId: string): Promise<string> {
    const row = targetType === 'FOLDER'
      ? await this.prisma.driveFolder.findFirst({ where: { id: targetId }, select: { companyId: true } })
      : await this.prisma.document.findFirst({ where: { id: targetId }, select: { companyId: true } })
    if (!row) throw notFound()
    return row.companyId
  }

  /** Only an owner (or a global admin) may change who a folder or document is shared with. */
  private async assertTargetOwned(principal: AuthPrincipal, targetType: DriveShareTargetType, targetId: string): Promise<void> {
    const row = targetType === 'FOLDER'
      ? await this.prisma.driveFolder.findFirst({ where: { id: targetId, companyId: { in: principal.allowedCompanyIds } }, select: { ownerId: true } })
      : await this.prisma.document.findFirst({ where: { id: targetId, companyId: { in: principal.allowedCompanyIds } }, select: { ownerId: true } })
    if (!row) throw notFound()
    if (row.ownerId !== principal.userId && !isGlobalAdmin(principal)) throw forbidden()
  }

  private async assertTargetVisible(principal: AuthPrincipal, targetType: DriveShareTargetType, targetId: string): Promise<void> {
    const row = targetType === 'FOLDER'
      ? await this.prisma.driveFolder.findFirst({ where: { id: targetId, companyId: { in: principal.allowedCompanyIds } }, select: { ownerId: true } })
      : await this.prisma.document.findFirst({ where: { id: targetId, companyId: { in: principal.allowedCompanyIds } }, select: { ownerId: true } })
    if (!row) throw notFound()
    if (row.ownerId === principal.userId || isGlobalAdmin(principal)) return
    const grants = await this.grantsFor(principal)
    if (!grants.roleOf(targetType, targetId)) throw notFound()
  }
}
