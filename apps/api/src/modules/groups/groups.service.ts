import { Injectable } from '@nestjs/common'
import {
  OrganizationCapability,
  type CreateGroupInput,
  type GroupDetailView,
  type GroupListItem,
  type GroupListQuery,
  type GroupListResult,
  type UpdateGroupInput,
} from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CapabilitiesService } from '../authorization/capabilities.service.js'
import { ScopeService } from '../authorization/scope.service.js'

interface GroupCursor {
  updatedAt: string
  id: string
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly capabilities: CapabilitiesService,
  ) {}

  async list(principal: AuthPrincipal, query: GroupListQuery): Promise<GroupListResult> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      query.company,
      OrganizationCapability.GroupsUi,
    )
    if (companyIds.length === 0) return { items: [], nextCursor: null }

    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const membership = { some: { userId: principal.userId, leftAt: null } }
    const groups = await this.prisma.group.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        status: query.status,
        AND: [
          query.status === 'ARCHIVED'
            ? { members: membership }
            : { OR: [{ discoverability: 'LISTED' }, { members: membership }] },
          ...(query.query
            ? [{ OR: [
                { name: { contains: query.query } },
                { key: { contains: query.query } },
                { description: { contains: query.query } },
              ] }]
            : []),
          ...(cursor
            ? [{ OR: [
                { updatedAt: { lt: new Date(cursor.updatedAt) } },
                { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
              ] }]
            : []),
        ],
      },
      select: {
        id: true,
        companyId: true,
        key: true,
        name: true,
        description: true,
        discoverability: true,
        joinPolicy: true,
        status: true,
        updatedAt: true,
        version: true,
        owner: { select: { id: true, displayName: true } },
        members: {
          where: { userId: principal.userId, leftAt: null },
          select: { role: true },
          take: 1,
        },
        _count: { select: { members: { where: { leftAt: null } } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })

    const hasMore = groups.length > query.limit
    const page = groups.slice(0, query.limit)
    return {
      items: page.map((group) => this.toListItem(group)),
      nextCursor: hasMore && page.length > 0
        ? this.encodeCursor({ updatedAt: page.at(-1)!.updatedAt.toISOString(), id: page.at(-1)!.id })
        : null,
    }
  }

  async create(principal: AuthPrincipal, input: CreateGroupInput): Promise<{ id: string }> {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    await this.capabilities.assertEnabled(principal, companyId, OrganizationCapability.GroupsUi)
    const groupId = id('grp')
    const keyBase = input.name.toLocaleLowerCase('uk-UA')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'group'
    await this.prisma.$transaction(async (tx) => {
      await tx.group.create({
        data: {
          id: groupId,
          workspaceId: principal.workspaceId,
          companyId,
          key: `${keyBase}-${groupId.slice(-6)}`,
          name: input.name,
          description: input.description || null,
          discoverability: input.discoverability,
          joinPolicy: input.joinPolicy,
          ownerId: principal.userId,
        },
      })
      await tx.groupMember.create({
        data: {
          id: id('gmem'),
          groupId,
          userId: principal.userId,
          role: 'OWNER',
        },
      })
    })
    return { id: groupId }
  }

  async detail(principal: AuthPrincipal, groupId: string, company?: string): Promise<GroupDetailView> {
    const allowedCompanyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      company,
      OrganizationCapability.GroupsUi,
    )
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, workspaceId: principal.workspaceId, companyId: { in: allowedCompanyIds } },
      select: {
        id: true,
        companyId: true,
        key: true,
        name: true,
        description: true,
        discoverability: true,
        joinPolicy: true,
        status: true,
        updatedAt: true,
        version: true,
        owner: { select: { id: true, displayName: true } },
        members: {
          where: { userId: principal.userId, leftAt: null },
          select: { role: true },
          take: 1,
        },
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    })
    if (!group) throw notFound()
    const isMember = group.members.length > 0
    if ((!isMember && group.discoverability === 'HIDDEN') || (!isMember && group.status === 'ARCHIVED')) throw notFound()
    const canManageMembers = ['OWNER', 'MODERATOR'].includes(group.members[0]?.role ?? '')
      || isGlobalAdmin(principal)
    const canEdit = group.members[0]?.role === 'OWNER' || isGlobalAdmin(principal)
    const [members, pendingRequests, currentRequest] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId, leftAt: null },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          user: { select: { id: true, displayName: true, avatarAsset: true } },
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      }),
      canManageMembers
        ? this.prisma.groupJoinRequest.findMany({
            where: { groupId, status: 'PENDING' },
            select: {
              id: true,
              status: true,
              createdAt: true,
              requester: { select: { id: true, displayName: true, avatarAsset: true } },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [],
      this.prisma.groupJoinRequest.findFirst({
        where: { groupId, requesterId: principal.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { status: true },
      }),
    ])
    return {
      ...this.toListItem(group),
      members: members.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() })),
      pendingRequests: pendingRequests.map((request) => ({
        ...request,
        createdAt: request.createdAt.toISOString(),
      })),
      currentUserRequestStatus: currentRequest?.status ?? null,
      canManageMembers,
      canEdit,
    }
  }

  async update(principal: AuthPrincipal, groupId: string, input: UpdateGroupInput): Promise<{ version: number }> {
    await this.capabilities.assertEnabled(principal, principal.primaryCompanyId ?? principal.allowedCompanyIds[0], OrganizationCapability.GroupsUi)
    const group = await this.manageableGroup(principal, groupId)
    if (group.version !== input.expectedVersion || group.status !== 'ACTIVE') throw conflict()
    const changed = await this.prisma.group.updateMany({
      where: { id: groupId, version: input.expectedVersion, status: 'ACTIVE' },
      data: {
        name: input.name,
        description: input.description || null,
        discoverability: input.discoverability,
        joinPolicy: input.joinPolicy,
        version: { increment: 1 },
      },
    })
    if (changed.count !== 1) throw conflict()
    return { version: input.expectedVersion + 1 }
  }

  async archive(principal: AuthPrincipal, groupId: string, expectedVersion: number): Promise<{ archived: true }> {
    await this.capabilities.assertEnabled(principal, principal.primaryCompanyId ?? principal.allowedCompanyIds[0], OrganizationCapability.GroupsUi)
    const group = await this.manageableGroup(principal, groupId)
    if (group.version !== expectedVersion || group.status !== 'ACTIVE') throw conflict()
    const changed = await this.prisma.group.updateMany({
      where: { id: groupId, version: expectedVersion, status: 'ACTIVE' },
      data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } },
    })
    if (changed.count !== 1) throw conflict()
    return { archived: true }
  }

  async join(principal: AuthPrincipal, groupId: string): Promise<{ state: 'JOINED' | 'PENDING' }> {
    await this.capabilities.assertEnabled(principal, principal.primaryCompanyId ?? principal.allowedCompanyIds[0], OrganizationCapability.GroupsUi)
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
        status: 'ACTIVE',
        discoverability: 'LISTED',
      },
      include: {
        members: { where: { userId: principal.userId }, take: 1 },
      },
    })
    if (!group) throw notFound()
    const membership = group.members[0]
    if (membership && !membership.leftAt) return { state: 'JOINED' }
    if (group.joinPolicy === 'INVITE_ONLY') throw forbidden()
    if (group.joinPolicy === 'REQUEST') {
      const activeKey = `${group.id}:${principal.userId}`
      const existing = await this.prisma.groupJoinRequest.findUnique({ where: { activeKey } })
      if (!existing) {
        await this.prisma.groupJoinRequest.create({
          data: {
            id: id('greq'),
            groupId,
            requesterId: principal.userId,
            activeKey,
          },
        })
      }
      return { state: 'PENDING' }
    }
    await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId: principal.userId } },
      create: { id: id('gmem'), groupId, userId: principal.userId, role: 'MEMBER' },
      update: { leftAt: null, joinedAt: new Date(), role: 'MEMBER', version: { increment: 1 } },
    })
    return { state: 'JOINED' }
  }

  async leave(principal: AuthPrincipal, groupId: string): Promise<{ left: true }> {
    await this.capabilities.assertEnabled(principal, principal.primaryCompanyId ?? principal.allowedCompanyIds[0], OrganizationCapability.GroupsUi)
    const membership = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: principal.userId,
        leftAt: null,
        group: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
          status: 'ACTIVE',
        },
      },
    })
    if (!membership) throw notFound()
    if (membership.role === 'OWNER') throw badRequest('group_owner_cannot_leave')
    await this.prisma.groupMember.update({
      where: { id: membership.id },
      data: { leftAt: new Date(), version: { increment: 1 } },
    })
    return { left: true }
  }

  async decideRequest(
    principal: AuthPrincipal,
    groupId: string,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<{ decided: true }> {
    await this.capabilities.assertEnabled(principal, principal.primaryCompanyId ?? principal.allowedCompanyIds[0], OrganizationCapability.GroupsUi)
    const manager = await this.prisma.groupMember.findFirst({
      where: { groupId, userId: principal.userId, leftAt: null, role: { in: ['OWNER', 'MODERATOR'] } },
    })
    if (!manager && !isGlobalAdmin(principal)) throw forbidden()
    const request = await this.prisma.groupJoinRequest.findFirst({
      where: {
        id: requestId,
        groupId,
        status: 'PENDING',
        group: { workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds } },
      },
    })
    if (!request) throw notFound()
    await this.prisma.$transaction(async (tx) => {
      await tx.groupJoinRequest.update({
        where: { id: request.id },
        data: {
          status: decision,
          activeKey: null,
          decidedById: principal.userId,
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      })
      if (decision === 'APPROVED') {
        await tx.groupMember.upsert({
          where: { groupId_userId: { groupId, userId: request.requesterId } },
          create: { id: id('gmem'), groupId, userId: request.requesterId, role: 'MEMBER' },
          update: { leftAt: null, joinedAt: new Date(), role: 'MEMBER', version: { increment: 1 } },
        })
      }
    })
    return { decided: true }
  }

  private async manageableGroup(principal: AuthPrincipal, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
      },
      include: {
        members: {
          where: { userId: principal.userId, leftAt: null, role: 'OWNER' },
          take: 1,
        },
      },
    })
    if (!group || (group.members.length === 0 && !isGlobalAdmin(principal))) throw notFound()
    return group
  }

  private toListItem(group: {
    id: string
    companyId: string
    key: string
    name: string
    description: string | null
    discoverability: 'LISTED' | 'HIDDEN'
    joinPolicy: 'OPEN' | 'REQUEST' | 'INVITE_ONLY'
    status: 'ACTIVE' | 'ARCHIVED'
    updatedAt: Date
    version: number
    owner: { id: string; displayName: string }
    members: Array<{ role: 'OWNER' | 'MODERATOR' | 'MEMBER' }>
    _count: { members: number }
  }): GroupListItem {
    return {
      id: group.id,
      companyId: group.companyId,
      key: group.key,
      name: group.name,
      description: group.description,
      discoverability: group.discoverability,
      joinPolicy: group.joinPolicy,
      status: group.status,
      owner: group.owner,
      memberCount: group._count.members,
      currentUserRole: group.members[0]?.role ?? null,
      updatedAt: group.updatedAt.toISOString(),
      version: group.version,
    }
  }

  private encodeCursor(cursor: GroupCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(value: string): GroupCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<GroupCursor>
      if (!parsed.id || !parsed.updatedAt || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error('invalid')
      return { id: parsed.id, updatedAt: parsed.updatedAt }
    } catch {
      throw badRequest('groups_cursor_invalid')
    }
  }
}
