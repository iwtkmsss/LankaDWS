import { Injectable } from '@nestjs/common'
import {
  OrganizationCapability,
  type CreateFeedCommentInput,
  type CreateFeedPostInput,
  type FeedAudienceOption,
  type FeedAudienceFacetOption,
  type FeedAuthorOption,
  type FeedEntryView,
  type FeedListQuery,
  type FeedListResult,
  type FeedPostView,
  type FeedSourceView,
  type FeedSubscriptionMode,
  type MarkFeedReadInput,
  type ShareFileToFeedInput,
  type UpdateFeedPostInput,
} from '@bert-crm/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CapabilitiesService } from '../authorization/capabilities.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import {
  advanceFeedSourceHead,
  moveFeedFavorites,
  writeFeedProjection,
} from './feed-projection.service.js'

interface FeedCursor {
  occurredAt: string
  id: string
}

interface ResolvedAudience {
  groupId: string | null
  recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>
  userIds: string[]
}

type ListedFeedItem = Prisma.FeedItemGetPayload<{
  include: {
    userStates: true
    post: {
      include: {
        author: { select: { id: true; displayName: true; avatarAsset: true } }
        group: { select: { id: true; name: true } }
        recipients: true
        acknowledgementRecipients: true
        acknowledgements: true
        reactions: true
        subscriptions: true
      }
    }
  }
}>

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilitiesService,
    private readonly files: FilesService,
  ) {}

  async uploadAttachment(
    principal: AuthPrincipal,
    companyId: string,
    file: UploadedBinary,
  ) {
    await this.capabilities.assertEnabled(principal, companyId, OrganizationCapability.Feed)
    return this.files.upload(principal, companyId, file)
  }

  async shareFile(
    principal: AuthPrincipal,
    fileId: string,
    input: ShareFileToFeedInput,
    idempotencyKey: string,
  ): Promise<{ id: string; fileId: string; version: number; status: 'ACTIVE' }> {
    await this.capabilities.assertEnabled(principal, input.companyId, OrganizationCapability.Feed)
    const existingRequest = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'feed.file.share',
        },
      },
    })
    if (existingRequest?.resultId) {
      const share = await this.prisma.feedFileShare.findFirst({
        where: {
          id: existingRequest.resultId,
          workspaceId: principal.workspaceId,
          ownerId: principal.userId,
        },
        select: { id: true, fileId: true, version: true, status: true },
      })
      if (share?.status === 'ACTIVE') return { ...share, status: 'ACTIVE' }
    }

    const [file, audience] = await Promise.all([
      this.files.assertShareable(principal, input.companyId, fileId),
      this.resolveAudience(principal, input.companyId, input.audience),
    ])
    const audienceKey = audience.recipients
      .map((recipient) => `${recipient.type}:${recipient.recipientId}`)
      .sort()
      .join('|')
    const existingShare = await this.prisma.feedFileShare.findFirst({
      where: {
        fileId: file.id,
        ownerId: principal.userId,
        audienceKey,
        status: 'ACTIVE',
      },
      select: { id: true, fileId: true, version: true, status: true },
    })
    if (existingShare) return { ...existingShare, status: 'ACTIVE' }

    const shareId = id('fshare')
    const now = new Date()
    try {
      await this.prisma.$transaction(async (tx) => {
      await tx.feedFileShare.create({
        data: {
          id: shareId,
          workspaceId: principal.workspaceId,
          companyId: input.companyId,
          fileId: file.id,
          ownerId: principal.userId,
          audienceType: input.audience.type === 'USERS' ? 'USER' : input.audience.type,
          audienceKey,
          groupId: audience.groupId,
        },
      })
      const directUserIds = audience.recipients
        .filter((recipient) => recipient.type === 'USER')
        .map((recipient) => recipient.recipientId)
      if (directUserIds.length > 0) {
        await tx.feedFileShareRecipient.createMany({
          data: directUserIds.map((userId) => ({
            id: id('fshr'),
            shareId,
            userId,
          })),
        })
      }
      const itemId = await writeFeedProjection(tx, {
        workspaceId: principal.workspaceId,
        companyId: input.companyId,
        sourceType: 'FILE',
        sourceId: shareId,
        fileShareId: shareId,
        sourceVersion: 1,
        action: 'SHARED',
        actorId: principal.userId,
        recipientIds: audience.userIds,
        visibility: input.audience.type === 'COMPANY' ? 'COMPANY' : 'PARTICIPANTS',
        occurredAt: now,
      })
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'feed.file.share',
          requestFingerprint: idempotencyKey,
          resultType: 'FEED_FILE_SHARE',
          resultId: shareId,
          responseStatus: 201,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: input.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'feed.file.shared',
          entityType: 'FEED_FILE_SHARE',
          entityId: shareId,
          result: 'SUCCESS',
          risk: 'HIGH',
          safeDiffJson: JSON.stringify({
            audience: input.audience.type,
            recipientCount: audience.userIds.length,
            scanStatus: file.scanStatus,
          }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'FEED_FILE_SHARE',
          aggregateId: shareId,
          aggregateVersion: 1,
          eventType: 'feed.file.shared',
          safePayload: JSON.stringify({
            shareId,
            companyId: input.companyId,
            itemId,
          }),
        },
      })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const concurrentShare = await this.prisma.feedFileShare.findFirst({
          where: {
            fileId: file.id,
            ownerId: principal.userId,
            audienceKey,
            status: 'ACTIVE',
          },
          select: { id: true, fileId: true, version: true },
        })
        if (concurrentShare) return { ...concurrentShare, status: 'ACTIVE' }
      }
      throw error
    }
    return { id: shareId, fileId: file.id, version: 1, status: 'ACTIVE' }
  }

  async revokeFileShare(
    principal: AuthPrincipal,
    shareId: string,
    expectedVersion: number,
  ): Promise<{ revoked: true; version: number }> {
    const share = await this.prisma.feedFileShare.findFirst({
      where: {
        id: shareId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
      },
    })
    if (!share) throw notFound()
    await this.capabilities.assertEnabled(principal, share.companyId, OrganizationCapability.Feed)
    if (share.ownerId !== principal.userId && !principal.permissions.has('feed.moderate')) throw notFound()
    if (share.status === 'REVOKED') return { revoked: true, version: share.version }
    if (share.version !== expectedVersion) throw conflict()
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.feedFileShare.updateMany({
        where: { id: share.id, status: 'ACTIVE', version: expectedVersion },
        data: { status: 'REVOKED', version: { increment: 1 }, revokedAt: now },
      })
      if (updated.count !== 1) throw conflict()
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: share.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'feed.file.revoked',
          entityType: 'FEED_FILE_SHARE',
          entityId: share.id,
          result: 'SUCCESS',
          risk: 'HIGH',
          safeDiffJson: JSON.stringify({ fromVersion: expectedVersion, toVersion: expectedVersion + 1 }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'FEED_FILE_SHARE',
          aggregateId: share.id,
          aggregateVersion: expectedVersion + 1,
          eventType: 'feed.file.revoked',
          safePayload: JSON.stringify({ shareId: share.id, companyId: share.companyId }),
        },
      })
    })
    return { revoked: true, version: expectedVersion + 1 }
  }

  async audiences(principal: AuthPrincipal, company?: string): Promise<{ items: FeedAudienceOption[] }> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      company,
      OrganizationCapability.Feed,
    )
    if (companyIds.length === 0) return { items: [] }
    const [companies, groups] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds }, workspaceId: principal.workspaceId, status: 'ACTIVE' },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.group.findMany({
        where: {
          companyId: { in: companyIds },
          workspaceId: principal.workspaceId,
          status: 'ACTIVE',
          OR: [
            { ownerId: principal.userId },
            { members: { some: { userId: principal.userId, leftAt: null } } },
          ],
        },
        select: { id: true, companyId: true, name: true, description: true },
        orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
      }),
    ])
    return {
      items: [
        ...companies.map((item) => ({
          type: 'COMPANY' as const,
          id: item.id,
          companyId: item.id,
          label: item.displayName,
          detail: 'Усі активні працівники організації',
        })),
        ...groups.map((item) => ({
          type: 'GROUP' as const,
          id: item.id,
          companyId: item.companyId,
          label: item.name,
          detail: item.description?.trim() || 'Учасники робочої групи',
        })),
      ],
    }
  }

  async audienceFacets(
    principal: AuthPrincipal,
    company?: string,
  ): Promise<{ items: FeedAudienceFacetOption[] }> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      company,
      OrganizationCapability.Feed,
    )
    if (companyIds.length === 0) return { items: [] }
    const access = await this.accessiblePostWhere(principal, companyIds)
    const fileShareAccess = this.accessibleFileShareWhere(principal, companyIds)
    const [companies, groupRecipients, userRecipients, fileGroupShares, fileUserRecipients] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds }, workspaceId: principal.workspaceId, status: 'ACTIVE' },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.feedPostRecipient.groupBy({
        by: ['recipientId'],
        where: {
          type: 'GROUP',
          post: { is: { ...access, status: 'PUBLISHED' } },
        },
      }),
      this.prisma.feedPostRecipient.groupBy({
        by: ['recipientId'],
        where: {
          type: 'USER',
          post: { is: { ...access, status: 'PUBLISHED' } },
        },
      }),
      principal.permissions.has('documents.read')
        ? this.prisma.feedFileShare.findMany({
            where: {
              ...fileShareAccess,
              audienceType: 'GROUP',
              groupId: { not: null },
            },
            distinct: ['groupId'],
            select: { groupId: true },
          })
        : Promise.resolve([]),
      principal.permissions.has('documents.read')
        ? this.prisma.feedFileShareRecipient.groupBy({
            by: ['userId'],
            where: { share: { is: fileShareAccess } },
          })
        : Promise.resolve([]),
    ])
    const groupRecipientIds = [...new Set([
      ...groupRecipients.map((item) => item.recipientId),
      ...fileGroupShares.flatMap((item) => item.groupId ? [item.groupId] : []),
    ])]
    const userRecipientIds = [...new Set([
      ...userRecipients.map((item) => item.recipientId),
      ...fileUserRecipients.map((item) => item.userId),
    ])]
    const [groups, users] = await Promise.all([
      groupRecipientIds.length > 0
        ? this.prisma.group.findMany({
            where: {
              id: { in: groupRecipientIds },
              workspaceId: principal.workspaceId,
              companyId: { in: companyIds },
              status: 'ACTIVE',
            },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      userRecipientIds.length > 0
        ? this.prisma.user.findMany({
            where: {
              id: { in: userRecipientIds },
              workspaceId: principal.workspaceId,
              status: 'ACTIVE',
            },
            select: { id: true, displayName: true },
            orderBy: { displayName: 'asc' },
          })
        : Promise.resolve([]),
    ])
    return {
      items: [
        ...companies.map((item) => ({
          type: 'COMPANY' as const,
          id: item.id,
          label: item.displayName,
          detail: 'Події стрічки для всієї організації',
          queryKey: 'audienceId' as const,
        })),
        ...groups.map((item) => ({
          type: 'GROUP' as const,
          id: item.id,
          label: item.name,
          detail: 'Події стрічки в контексті робочої групи',
          queryKey: 'groupId' as const,
        })),
        ...users.map((item) => ({
          type: 'USER' as const,
          id: item.id,
          label: item.id === principal.userId ? 'Особисто мені' : item.displayName,
          detail: item.id === principal.userId
            ? 'Події стрічки, адресовані вам'
            : `Події стрічки для ${item.displayName}`,
          queryKey: 'audienceId' as const,
        })),
      ],
    }
  }

  async authors(principal: AuthPrincipal, company?: string): Promise<{ items: FeedAuthorOption[] }> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      company,
      OrganizationCapability.Feed,
    )
    if (companyIds.length === 0) return { items: [] }
    const access = await this.accessiblePostWhere(principal, companyIds)
    const [posts, sourceItems] = await Promise.all([
      this.prisma.feedPost.findMany({
        where: { ...access, status: 'PUBLISHED' },
        distinct: ['authorId'],
        select: {
          author: { select: { id: true, displayName: true, avatarAsset: true } },
        },
      }),
      this.prisma.feedSourceHead.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId: { in: companyIds },
          item: {
            is: {
              postId: null,
              ...this.feedItemAccessWhere(principal, { ...access, status: 'PUBLISHED' }),
            },
          },
        },
        include: {
          item: {
            include: {
              userStates: { where: { userId: principal.userId } },
              post: {
                include: {
                  author: { select: { id: true, displayName: true, avatarAsset: true } },
                  group: { select: { id: true, name: true } },
                  recipients: true,
                  acknowledgementRecipients: true,
                  acknowledgements: true,
                  reactions: true,
                  subscriptions: true,
                },
              },
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { itemId: 'desc' }],
        take: 500,
      }),
    ])
    const sourceViews = await this.toSourceViews(
      principal,
      sourceItems.map(({ item }) => item),
    )
    const byId = new Map<string, FeedAuthorOption>()
    for (const { author } of posts) byId.set(author.id, author)
    for (const view of sourceViews) {
      if (view.actor) byId.set(view.actor.id, view.actor)
    }
    return {
      items: [...byId.values()].sort((left, right) =>
        left.displayName.localeCompare(right.displayName, 'uk-UA')),
    }
  }

  async list(principal: AuthPrincipal, query: FeedListQuery): Promise<FeedListResult> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      query.company,
      OrganizationCapability.Feed,
    )
    if (companyIds.length === 0) {
      return {
        items: [],
        nextCursor: null,
        unreadCount: 0,
        attention: { pendingAcknowledgements: 0, overdueTasks: 0 },
        readMarkers: [],
      }
    }
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const access = await this.accessiblePostWhere(principal, companyIds)
    const dateAccess = await this.dateAccessWhere(companyIds, query.dateFrom, query.dateTo)
    const postFilters: Prisma.FeedPostWhereInput = {
      ...access,
      status: 'PUBLISHED',
      ...(query.filter === 'MINE' ? { authorId: principal.userId } : {}),
      ...(query.filter === 'FOLLOWING'
        ? { subscriptions: { some: { userId: principal.userId, mode: { not: 'NONE' } } } }
        : {}),
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.audienceId
        ? { recipients: { some: { recipientId: query.audienceId } } }
        : {}),
      ...(query.mentioned ? { mentions: { some: { userId: principal.userId } } } : {}),
      ...(query.important ? { requiresAcknowledgement: true } : {}),
      ...(query.filter === 'ACK_REQUIRED'
        ? { acknowledgementRecipients: { some: { userId: principal.userId } } }
        : {}),
    }
    const itemAccess = this.feedItemAccessWhere(principal, postFilters, query)
    const scanLimit = Math.min(query.limit * 10 + 1, 501)
    const rawHeads = await this.prisma.feedSourceHead.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        AND: [
          {
            item: {
              is: {
                AND: [
                  itemAccess,
                  ...(query.favorite
                    ? [{ userStates: { some: { userId: principal.userId, favoritedAt: { not: null } } } }]
                    : []),
                  ...(dateAccess ? [dateAccess] : []),
                ],
              },
            },
          },
          ...(cursor
            ? [{
              OR: [
                { occurredAt: { lt: new Date(cursor.occurredAt) } },
                { occurredAt: new Date(cursor.occurredAt), itemId: { lt: cursor.id } },
              ],
            }]
            : []),
        ],
      },
      include: {
        item: {
          include: {
            userStates: { where: { userId: principal.userId } },
            post: {
              include: {
                author: { select: { id: true, displayName: true, avatarAsset: true } },
                group: { select: { id: true, name: true } },
                recipients: true,
                acknowledgementRecipients: true,
                acknowledgements: true,
                reactions: true,
                subscriptions: true,
              },
            },
          },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { itemId: 'desc' }],
      take: scanLimit,
    })
    const currentItems: ListedFeedItem[] = []
    for (const { item } of rawHeads) {
      if (item.post) {
        const needsCurrentAcknowledgement = item.post.requiresAcknowledgement
          && item.post.acknowledgementRecipients.some((entry) =>
            entry.userId === principal.userId
            && entry.acknowledgementVersion === item.post!.acknowledgementVersion
            && !item.post!.acknowledgements.some((ack) =>
              ack.userId === principal.userId
              && ack.acknowledgementVersion === item.post!.acknowledgementVersion),
          )
        if (query.filter === 'ACK_REQUIRED' && !needsCurrentAcknowledgement) continue
      }
      currentItems.push(item)
    }
    const visibleEntries = await this.toEntries(principal, currentItems)
    const pageEntries = visibleEntries.slice(0, query.limit)
    const pageItemIds = new Set(pageEntries.map((entry) => entry.itemId))
    const page = currentItems.filter((item) => pageItemIds.has(item.id))
    const [pendingAcknowledgements, overdueTasks, unreadCount] = await Promise.all([
      this.pendingAcknowledgementCount(principal, access),
      this.prisma.task.count({
        where: {
          companyId: { in: companyIds },
          participants: {
            some: {
              userId: principal.userId,
              role: 'RESPONSIBLE',
              removedAt: null,
            },
          },
          OR: [
            { groupId: null },
            {
              group: {
                members: {
                  some: {
                    userId: principal.userId,
                    leftAt: null,
                  },
                },
              },
            },
          ],
          archivedAt: null,
          dueAt: { lt: new Date() },
          status: { notIn: ['DONE', 'CANCELLED', 'ARCHIVED'] },
        },
      }),
      this.unreadCount(principal, companyIds, access),
    ])
    const readMarkers = new Map<string, string>()
    for (const item of page) {
      if (!readMarkers.has(item.companyId)) readMarkers.set(item.companyId, item.id)
    }
    const last = page.at(-1)
    const lastScanned = rawHeads.at(-1)
    const hasBufferedVisibleEntry = visibleEntries.length > query.limit
    const hasMoreUnscannedHeads = rawHeads.length === scanLimit
    const nextPosition = hasBufferedVisibleEntry
      ? last
      : hasMoreUnscannedHeads
        ? lastScanned
          ? { id: lastScanned.itemId, occurredAt: lastScanned.occurredAt }
          : null
        : null
    return {
      items: pageEntries,
      nextCursor: nextPosition
        ? this.encodeCursor({
            occurredAt: nextPosition.occurredAt.toISOString(),
            id: nextPosition.id,
          })
        : null,
      unreadCount,
      attention: { pendingAcknowledgements, overdueTasks },
      readMarkers: [...readMarkers].map(([companyId, lastItemId]) => ({ companyId, lastItemId })),
    }
  }

  async setFavorite(
    principal: AuthPrincipal,
    itemId: string,
    favorited: boolean,
  ): Promise<{ favorited: boolean }> {
    const item = await this.accessibleItem(principal, itemId)
    const sourceItems = await this.prisma.feedItem.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: item.companyId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      },
      select: { id: true },
    })
    const sourceItemIds = sourceItems.map((entry) => entry.id)
    const currentItemId = item.id
    await this.prisma.$transaction(async (tx) => {
      await tx.feedUserItemState.deleteMany({
        where: { userId: principal.userId, feedItemId: { in: sourceItemIds } },
      })
      if (favorited) {
        await tx.feedUserItemState.create({
          data: {
            id: id('fstate'),
            userId: principal.userId,
            feedItemId: currentItemId,
            favoritedAt: new Date(),
          },
        })
      }
    })
    return { favorited }
  }

  async detail(principal: AuthPrincipal, postId: string): Promise<FeedPostView> {
    const post = await this.accessiblePost(principal, postId)
    const item = await this.prisma.feedItem.findFirst({
      where: { postId: post.id, sourceHead: { isNot: null } },
      include: {
        userStates: { where: { userId: principal.userId } },
        post: {
          include: {
            author: { select: { id: true, displayName: true, avatarAsset: true } },
            group: { select: { id: true, name: true } },
            recipients: true,
            acknowledgementRecipients: true,
            acknowledgements: true,
            reactions: true,
            subscriptions: true,
          },
        },
      },
    })
    if (!item?.post) throw notFound()
    return (await this.toViews(principal, [item]))[0]
  }

  async create(
    principal: AuthPrincipal,
    input: CreateFeedPostInput,
    idempotencyKey: string,
  ): Promise<{ id: string; version: number }> {
    await this.capabilities.assertEnabled(principal, input.companyId, OrganizationCapability.Feed)
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'feed.post.create',
        },
      },
    })
    if (existing?.resultId) {
      const post = await this.prisma.feedPost.findUnique({
        where: { id: existing.resultId },
        select: { id: true, version: true },
      })
      if (post) return post
    }
    const audience = await this.resolveAudience(principal, input.companyId, input.audience)
    this.assertMentions(input.mentionedUserIds, audience.userIds, principal.userId)
    await this.files.assertAttachable(principal, input.companyId, input.attachmentIds)
    const postId = id('feed')
    const itemId = id('fitem')
    const now = new Date()
    const acknowledgementVersion = input.requiresAcknowledgement ? 1 : 0
    await this.prisma.$transaction(async (tx) => {
      await tx.feedPost.create({
        data: {
          id: postId,
          workspaceId: principal.workspaceId,
          companyId: input.companyId,
          groupId: audience.groupId,
          authorId: principal.userId,
          body: input.body,
          requiresAcknowledgement: input.requiresAcknowledgement,
          acknowledgementVersion,
          publishedAt: now,
        },
      })
      await tx.feedPostRecipient.createMany({
        data: audience.recipients.map((recipient) => ({
          id: id('frcp'),
          postId,
          ...recipient,
        })),
      })
      const acknowledgementUserIds = input.requiresAcknowledgement
        ? audience.userIds.filter((userId) => userId !== principal.userId)
        : []
      if (acknowledgementUserIds.length > 0) {
        await tx.feedAcknowledgementRecipient.createMany({
          data: acknowledgementUserIds.map((userId) => ({
            id: id('fackr'),
            postId,
            userId,
            acknowledgementVersion,
          })),
        })
      }
      await tx.feedItem.create({
        data: this.itemData(principal, {
          id: itemId,
          postId,
          companyId: input.companyId,
          sourceVersion: 1,
          action: 'PUBLISHED',
          body: input.body,
          occurredAt: now,
          visibility: input.audience.type,
        }),
      })
      await advanceFeedSourceHead(tx, {
        workspaceId: principal.workspaceId,
        companyId: input.companyId,
        sourceType: 'POST',
        sourceId: postId,
        itemId,
        sourceVersion: 1,
        countsAsUnread: true,
        occurredAt: now,
      })
      if (input.attachmentIds.length > 0) {
        await tx.fileLink.createMany({
          data: input.attachmentIds.map((fileId) => ({
            id: id('flink'),
            fileId,
            entityType: 'FEED_POST',
            entityId: postId,
            purpose: 'ATTACHMENT',
            aclMode: 'INHERIT',
          })),
        })
      }
      if (input.mentionedUserIds.length > 0) {
        await tx.feedMention.createMany({
          data: input.mentionedUserIds.map((userId) => ({
            id: id('fmt'),
            postId,
            userId,
          })),
        })
      }
      await tx.feedSubscription.createMany({
        data: [...new Set([principal.userId, ...input.mentionedUserIds])].map((userId) => ({
          id: id('fsub'),
          postId,
          userId,
          mode: userId === principal.userId ? 'ALL' : 'MENTIONS',
        })),
      })
      const acknowledgementUsers = new Set(acknowledgementUserIds)
      const notificationUsers = new Set([
        ...acknowledgementUserIds,
        ...input.mentionedUserIds.filter((userId) => userId !== principal.userId),
      ])
      for (const userId of notificationUsers) {
        const requiresAction = acknowledgementUsers.has(userId)
        const dedupeKey = `feed-post:${postId}:${requiresAction ? 'ack' : 'mention'}:${userId}`
        await tx.notification.upsert({
          where: { dedupeKey },
          create: {
            id: id('ntf'),
            recipientId: userId,
            category: requiresAction ? 'FEED' : 'MENTION',
            safeTitle: requiresAction
              ? 'Потрібне підтвердження публікації'
              : 'Вас згадали у публікації',
            safeSnippet: requiresAction
              ? 'Відкрийте стрічку та підтвердьте ознайомлення окремою дією.'
              : 'Відкрийте стрічку, щоб переглянути згадку.',
            entityType: 'FEED_POST',
            entityId: postId,
            requiresAction,
            deliveredAt: now,
            dedupeKey,
          },
          update: {},
        })
      }
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'feed.post.create',
          requestFingerprint: idempotencyKey,
          resultType: 'FEED_POST',
          resultId: postId,
          responseStatus: 201,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: this.auditData(principal, input.companyId, 'feed.post.published', postId, {
          audience: input.audience.type,
          requiresAcknowledgement: input.requiresAcknowledgement,
        }),
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'FEED_POST',
          aggregateId: postId,
          aggregateVersion: 1,
          eventType: 'feed.post.published',
          safePayload: JSON.stringify({ postId, companyId: input.companyId, itemId }),
        },
      })
    })
    return { id: postId, version: 1 }
  }

  async update(
    principal: AuthPrincipal,
    postId: string,
    input: UpdateFeedPostInput,
  ): Promise<{ id: string; version: number; acknowledgementVersion: number }> {
    const post = await this.editablePost(principal, postId)
    if (post.version !== input.expectedVersion) throw conflict(`Поточна версія: ${post.version}`)
    const nextVersion = post.version + 1
    const nextAcknowledgementVersion = post.requiresAcknowledgement
      ? post.acknowledgementVersion + 1
      : 0
    const audienceUserIds = post.requiresAcknowledgement
      ? (await this.expandStoredAudience(post.companyId, post.recipients)).filter((userId) => userId !== post.authorId)
      : []
    const itemId = id('fitem')
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.feedPost.updateMany({
        where: { id: post.id, version: input.expectedVersion, status: 'PUBLISHED' },
        data: {
          body: input.body,
          version: nextVersion,
          editedAt: now,
          acknowledgementVersion: nextAcknowledgementVersion,
        },
      })
      if (!result.count) throw conflict()
      if (audienceUserIds.length > 0) {
        await tx.feedAcknowledgementRecipient.createMany({
          data: audienceUserIds.map((userId) => ({
            id: id('fackr'),
            postId,
            userId,
            acknowledgementVersion: nextAcknowledgementVersion,
          })),
        })
      }
      await tx.feedItem.create({
        data: this.itemData(principal, {
          id: itemId,
          postId,
          companyId: post.companyId,
          sourceVersion: nextVersion,
          action: 'EDITED',
          body: input.body,
          occurredAt: now,
          visibility: post.recipients[0]?.type ?? 'USERS',
        }),
      })
      await advanceFeedSourceHead(tx, {
        workspaceId: principal.workspaceId,
        companyId: post.companyId,
        sourceType: 'POST',
        sourceId: post.id,
        itemId,
        sourceVersion: nextVersion,
        countsAsUnread: true,
        occurredAt: now,
      })
      await moveFeedFavorites(tx, {
        workspaceId: principal.workspaceId,
        companyId: post.companyId,
        sourceType: 'POST',
        sourceId: post.id,
        newItemId: itemId,
      })
      await tx.auditEvent.create({
        data: this.auditData(principal, post.companyId, 'feed.post.edited', postId, {
          version: { from: post.version, to: nextVersion },
          acknowledgementVersion: { from: post.acknowledgementVersion, to: nextAcknowledgementVersion },
        }),
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'FEED_POST',
          aggregateId: postId,
          aggregateVersion: nextVersion,
          eventType: 'feed.post.edited',
          safePayload: JSON.stringify({ postId, companyId: post.companyId, itemId }),
        },
      })
    })
    return { id: postId, version: nextVersion, acknowledgementVersion: nextAcknowledgementVersion }
  }

  async archive(
    principal: AuthPrincipal,
    postId: string,
    expectedVersion: number,
  ): Promise<{ id: string; version: number; archived: true }> {
    const post = await this.editablePost(principal, postId)
    if (post.version !== expectedVersion) throw conflict(`Поточна версія: ${post.version}`)
    const nextVersion = post.version + 1
    const now = new Date()
    const itemId = id('fitem')
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.feedPost.updateMany({
        where: { id: post.id, version: expectedVersion, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED', version: nextVersion, archivedAt: now },
      })
      if (!result.count) throw conflict()
      await tx.feedItem.create({
        data: this.itemData(principal, {
          id: itemId,
          postId,
          companyId: post.companyId,
          sourceVersion: nextVersion,
          action: 'ARCHIVED',
          body: '',
          occurredAt: now,
          visibility: post.recipients[0]?.type ?? 'USERS',
        }),
      })
      await advanceFeedSourceHead(tx, {
        workspaceId: principal.workspaceId,
        companyId: post.companyId,
        sourceType: 'POST',
        sourceId: post.id,
        itemId,
        sourceVersion: nextVersion,
        countsAsUnread: true,
        occurredAt: now,
      })
      await moveFeedFavorites(tx, {
        workspaceId: principal.workspaceId,
        companyId: post.companyId,
        sourceType: 'POST',
        sourceId: post.id,
        newItemId: itemId,
      })
      await tx.auditEvent.create({
        data: this.auditData(principal, post.companyId, 'feed.post.archived', postId, {
          version: { from: post.version, to: nextVersion },
        }),
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'FEED_POST',
          aggregateId: postId,
          aggregateVersion: nextVersion,
          eventType: 'feed.post.archived',
          safePayload: JSON.stringify({ postId, companyId: post.companyId, itemId }),
        },
      })
    })
    return { id: postId, version: nextVersion, archived: true }
  }

  async comment(principal: AuthPrincipal, postId: string, input: CreateFeedCommentInput) {
    const post = await this.accessiblePost(principal, postId)
    let parent: { id: string; replyToCommentId: string | null } | null = null
    if (input.replyToCommentId) {
      parent = await this.prisma.comment.findFirst({
        where: {
          id: input.replyToCommentId,
          entityType: 'FEED_POST',
          entityId: post.id,
          deletedAt: null,
        },
        select: { id: true, replyToCommentId: true },
      })
      if (!parent || parent.replyToCommentId) throw badRequest('feed_comment_reply_depth')
    }
    const audienceUserIds = await this.expandStoredAudience(post.companyId, post.recipients)
    this.assertMentions(input.mentionedUserIds, audienceUserIds, principal.userId)
    const activeNotificationUsers = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set([...audienceUserIds, post.authorId])] },
        status: 'ACTIVE',
        companyAccess: { some: { companyId: post.companyId, status: 'ACTIVE' } },
      },
      select: { id: true },
    })
    const activeNotificationUserIds = activeNotificationUsers.map((user) => user.id)
    const commentId = id('cmt')
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          id: commentId,
          workspaceId: principal.workspaceId,
          companyId: post.companyId,
          entityType: 'FEED_POST',
          entityId: post.id,
          authorId: principal.userId,
          body: input.body,
          visibility: 'FEED_AUDIENCE',
          replyToCommentId: parent?.id,
        },
      })
      if (input.mentionedUserIds.length > 0) {
        await tx.feedMention.createMany({
          data: input.mentionedUserIds.map((userId) => ({
            id: id('fmt'),
            postId,
            commentId,
            userId,
          })),
        })
      }
      await tx.feedSubscription.upsert({
        where: { postId_userId: { postId, userId: principal.userId } },
        create: { id: id('fsub'), postId, userId: principal.userId, mode: 'ALL' },
        update: {},
      })
      for (const userId of input.mentionedUserIds) {
        await tx.feedSubscription.upsert({
          where: { postId_userId: { postId, userId } },
          create: { id: id('fsub'), postId, userId, mode: 'MENTIONS' },
          update: {},
        })
      }
      const mentioned = new Set(input.mentionedUserIds)
      const subscriptions = await tx.feedSubscription.findMany({
        where: {
          postId,
          userId: { in: activeNotificationUserIds, not: principal.userId },
          mode: { in: ['ALL', 'MENTIONS'] },
        },
        select: { userId: true, mode: true },
      })
      for (const subscription of subscriptions) {
        const isMention = mentioned.has(subscription.userId)
        if (subscription.mode === 'MENTIONS' && !isMention) continue
        await tx.notification.upsert({
          where: { dedupeKey: `feed-comment:${commentId}:${subscription.userId}` },
          create: {
            id: id('ntf'),
            recipientId: subscription.userId,
            category: isMention ? 'MENTION' : 'FEED',
            safeTitle: isMention ? 'Вас згадали у публікації' : 'Новий коментар у публікації',
            safeSnippet: 'Відкрийте стрічку, щоб переглянути новий контекст.',
            entityType: 'FEED_POST',
            entityId: postId,
            requiresAction: false,
            deliveredAt: new Date(),
            dedupeKey: `feed-comment:${commentId}:${subscription.userId}`,
          },
          update: {},
        })
      }
      await tx.auditEvent.create({
        data: this.auditData(principal, post.companyId, 'feed.comment.created', commentId, {
          postId,
          replyToCommentId: parent?.id ?? null,
        }),
      })
      return created
    })
    return { ...result, createdAt: result.createdAt.toISOString() }
  }

  async toggleLike(principal: AuthPrincipal, postId: string): Promise<{ liked: boolean; count: number }> {
    const post = await this.accessiblePost(principal, postId)
    const existing = await this.prisma.feedReaction.findUnique({
      where: { postId_userId_kind: { postId, userId: principal.userId, kind: 'LIKE' } },
    })
    if (existing) {
      await this.prisma.feedReaction.delete({ where: { id: existing.id } })
    } else {
      await this.prisma.feedReaction.create({
        data: { id: id('freact'), postId, userId: principal.userId, kind: 'LIKE' },
      })
    }
    const count = await this.prisma.feedReaction.count({ where: { postId, kind: 'LIKE' } })
    await this.prisma.auditEvent.create({
      data: this.auditData(
        principal,
        post.companyId,
        existing ? 'feed.reaction.removed' : 'feed.reaction.added',
        postId,
        { kind: 'LIKE' },
      ),
    })
    return { liked: !existing, count }
  }

  async updateSubscription(
    principal: AuthPrincipal,
    postId: string,
    notificationMode: FeedSubscriptionMode,
  ): Promise<{ notificationMode: FeedSubscriptionMode }> {
    await this.accessiblePost(principal, postId)
    await this.prisma.feedSubscription.upsert({
      where: { postId_userId: { postId, userId: principal.userId } },
      create: {
        id: id('fsub'),
        postId,
        userId: principal.userId,
        mode: notificationMode,
      },
      update: { mode: notificationMode },
    })
    return { notificationMode }
  }

  async acknowledge(
    principal: AuthPrincipal,
    postId: string,
    acknowledgementVersion: number,
  ): Promise<{ acknowledged: true; acknowledgedAt: string }> {
    const post = await this.accessiblePost(principal, postId)
    if (!post.requiresAcknowledgement || post.acknowledgementVersion !== acknowledgementVersion) {
      throw conflict('Публікацію оновлено. Перечитайте актуальну версію.')
    }
    const recipient = await this.prisma.feedAcknowledgementRecipient.findUnique({
      where: {
        postId_userId_acknowledgementVersion: {
          postId,
          userId: principal.userId,
          acknowledgementVersion,
        },
      },
    })
    if (!recipient) throw notFound()
    const existing = await this.prisma.feedPostAcknowledgement.findUnique({
      where: {
        postId_userId_acknowledgementVersion: {
          postId,
          userId: principal.userId,
          acknowledgementVersion,
        },
      },
    })
    if (existing) {
      return { acknowledged: true, acknowledgedAt: existing.acknowledgedAt.toISOString() }
    }
    const acknowledgement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feedPostAcknowledgement.create({
        data: {
          id: id('fack'),
          postId,
          userId: principal.userId,
          acknowledgementVersion,
        },
      })
      await tx.auditEvent.create({
        data: this.auditData(principal, post.companyId, 'feed.post.acknowledged', postId, {
          acknowledgementVersion,
        }),
      })
      return created
    })
    return { acknowledged: true, acknowledgedAt: acknowledgement.acknowledgedAt.toISOString() }
  }

  async markRead(
    principal: AuthPrincipal,
    input: MarkFeedReadInput,
  ): Promise<{ updated: number }> {
    const resolved: Array<{ companyId: string; item: { id: string; occurredAt: Date } }> = []
    for (const marker of input.markers) {
      await this.capabilities.assertEnabled(principal, marker.companyId, OrganizationCapability.Feed)
      const access = await this.accessiblePostWhere(principal, [marker.companyId])
      const item = await this.prisma.feedItem.findFirst({
        where: {
          id: marker.lastItemId,
          workspaceId: principal.workspaceId,
          companyId: marker.companyId,
          sourceHead: { isNot: null },
          ...this.feedItemAccessWhere(principal, { ...access, status: 'PUBLISHED' }),
        },
        select: { id: true, occurredAt: true },
      })
      if (!item) throw notFound()
      resolved.push({ companyId: marker.companyId, item })
    }
    return this.prisma.$transaction(async (tx) => {
      let updated = 0
      for (const marker of resolved) {
        const current = await tx.feedReadCursor.findUnique({
          where: { userId_companyId: { userId: principal.userId, companyId: marker.companyId } },
        })
        if (current && this.comparePosition(
          { occurredAt: current.lastReadOccurredAt.toISOString(), id: current.lastReadItemId },
          { occurredAt: marker.item.occurredAt.toISOString(), id: marker.item.id },
        ) >= 0) continue
        await tx.feedReadCursor.upsert({
          where: { userId_companyId: { userId: principal.userId, companyId: marker.companyId } },
          create: {
            id: id('fcur'),
            userId: principal.userId,
            companyId: marker.companyId,
            lastReadOccurredAt: marker.item.occurredAt,
            lastReadItemId: marker.item.id,
          },
          update: {
            lastReadOccurredAt: marker.item.occurredAt,
            lastReadItemId: marker.item.id,
          },
        })
        updated += 1
      }
      return { updated }
    })
  }

  private async accessibleItem(
    principal: AuthPrincipal,
    itemId: string,
  ): Promise<ListedFeedItem> {
    const companyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      'all',
      OrganizationCapability.Feed,
    )
    if (companyIds.length === 0) throw notFound()
    const access = await this.accessiblePostWhere(principal, companyIds)
    const item = await this.prisma.feedItem.findFirst({
      where: {
        id: itemId,
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        sourceHead: { isNot: null },
        ...this.feedItemAccessWhere(principal, { ...access, status: 'PUBLISHED' }),
      },
      include: {
        userStates: { where: { userId: principal.userId } },
        post: {
          include: {
            author: { select: { id: true, displayName: true, avatarAsset: true } },
            group: { select: { id: true, name: true } },
            recipients: true,
            acknowledgementRecipients: true,
            acknowledgements: true,
            reactions: true,
            subscriptions: true,
          },
        },
      },
    })
    if (!item || (await this.toEntries(principal, [item])).length === 0) throw notFound()
    return item
  }

  private async accessiblePost(principal: AuthPrincipal, postId: string) {
    const candidate = await this.prisma.feedPost.findFirst({
      where: { id: postId, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds } },
      select: { companyId: true },
    })
    if (!candidate) throw notFound()
    await this.capabilities.assertEnabled(principal, candidate.companyId, OrganizationCapability.Feed)
    const access = await this.accessiblePostWhere(principal, [candidate.companyId])
    const post = await this.prisma.feedPost.findFirst({
      where: { id: postId, status: 'PUBLISHED', ...access },
      include: { recipients: true },
    })
    if (!post) throw notFound()
    return post
  }

  private async editablePost(principal: AuthPrincipal, postId: string) {
    const post = await this.accessiblePost(principal, postId)
    if (post.authorId !== principal.userId && !principal.permissions.has('feed.moderate')) throw notFound()
    return post
  }

  private async accessiblePostWhere(
    principal: AuthPrincipal,
    companyIds: string[],
  ): Promise<Prisma.FeedPostWhereInput> {
    const memberships = await this.prisma.groupMember.findMany({
      where: {
        userId: principal.userId,
        leftAt: null,
        group: { companyId: { in: companyIds }, status: 'ACTIVE' },
      },
      select: { groupId: true },
    })
    const groupIds = memberships.map((item) => item.groupId)
    return {
      workspaceId: principal.workspaceId,
      companyId: { in: companyIds },
      OR: [
        { authorId: principal.userId },
        {
          recipients: {
            some: {
              OR: [
                { type: 'COMPANY', recipientId: { in: companyIds } },
                { type: 'USER', recipientId: principal.userId },
                ...(groupIds.length > 0
                  ? [{ type: 'GROUP' as const, recipientId: { in: groupIds } }]
                  : []),
              ],
            },
          },
        },
      ],
    }
  }

  private feedItemAccessWhere(
    principal: AuthPrincipal,
    postFilters: Prisma.FeedPostWhereInput,
    query: Pick<
      FeedListQuery,
      'filter' | 'type' | 'authorId' | 'groupId' | 'audienceId' | 'mentioned' | 'important'
    > = {
      filter: 'ALL',
      type: 'ALL',
    },
  ): Prisma.FeedItemWhereInput {
    const branches: Prisma.FeedItemWhereInput[] = []
    const allows = (type: 'POST' | 'TASK' | 'EVENT' | 'ANNOUNCEMENT' | 'FILE') =>
      query.type === 'ALL' || query.type === type
    if (allows('POST')) branches.push({ post: { is: postFilters } })
    if (
      query.filter !== 'ACK_REQUIRED'
      && query.filter !== 'FOLLOWING'
      && !query.mentioned
      && !query.important
    ) {
      const actorFilter = query.authorId ?? (query.filter === 'MINE' ? principal.userId : null)
      if (!query.groupId && !query.audienceId && allows('TASK') && principal.permissions.has('tasks.read')) {
        branches.push({
          postId: null,
          sourceType: 'TASK',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            ...(principal.permissions.has('tasks.manage')
              ? []
              : [{ recipients: { some: { userId: principal.userId } } }]),
          ],
        })
      }
      if (!query.groupId && !query.audienceId && allows('EVENT') && principal.permissions.has('calendar.read')) {
        branches.push({
          postId: null,
          sourceType: 'EVENT',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            {
              OR: [
                { visibility: 'COMPANY' },
                { recipients: { some: { userId: principal.userId } } },
              ],
            },
          ],
        })
      }
      if (!query.groupId && !query.audienceId && allows('ANNOUNCEMENT') && principal.permissions.has('announcements.read')) {
        branches.push({
          postId: null,
          sourceType: 'ANNOUNCEMENT',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            { recipients: { some: { userId: principal.userId } } },
          ],
        })
      }
      if (allows('FILE') && principal.permissions.has('documents.read')) {
        branches.push({
          postId: null,
          sourceType: 'FILE',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            {
              fileShare: {
                is: {
                  AND: [
                    this.accessibleFileShareWhere(principal, principal.allowedCompanyIds),
                    ...(query.groupId
                      ? [{ audienceType: 'GROUP' as const, groupId: query.groupId }]
                      : []),
                    ...(query.audienceId
                      ? [{
                          OR: [
                            { audienceType: 'COMPANY' as const, companyId: query.audienceId },
                            {
                              audienceType: 'USER' as const,
                              directRecipients: { some: { userId: query.audienceId } },
                            },
                          ],
                        }]
                      : []),
                  ],
                },
              },
            },
          ],
        })
      }
    }
    return branches.length > 0 ? { OR: branches } : { id: { in: [] } }
  }

  private accessibleFileShareWhere(
    principal: AuthPrincipal,
    companyIds: string[],
  ): Prisma.FeedFileShareWhereInput {
    return {
      workspaceId: principal.workspaceId,
      companyId: { in: companyIds },
      status: 'ACTIVE',
      OR: [
        { ownerId: principal.userId },
        { audienceType: 'COMPANY' },
        {
          audienceType: 'GROUP',
          group: {
            is: {
              status: 'ACTIVE',
              members: { some: { userId: principal.userId, leftAt: null } },
            },
          },
        },
        {
          audienceType: 'USER',
          directRecipients: { some: { userId: principal.userId } },
        },
      ],
    }
  }

  private async resolveAudience(
    principal: AuthPrincipal,
    companyId: string,
    audience: CreateFeedPostInput['audience'],
  ): Promise<ResolvedAudience> {
    if (audience.type === 'COMPANY') {
      const users = await this.activeCompanyUserIds(companyId)
      return {
        groupId: null,
        recipients: [{ type: 'COMPANY', recipientId: companyId }],
        userIds: users,
      }
    }
    if (audience.type === 'GROUP') {
      const group = await this.prisma.group.findFirst({
        where: {
          id: audience.groupId,
          workspaceId: principal.workspaceId,
          companyId,
          status: 'ACTIVE',
          ...(principal.permissions.has('feed.moderate')
            ? {}
            : {
                OR: [
                  { ownerId: principal.userId },
                  { members: { some: { userId: principal.userId, leftAt: null } } },
                ],
              }),
        },
        select: {
          id: true,
          members: { where: { leftAt: null }, select: { userId: true } },
        },
      })
      if (!group) throw badRequest('feed_group_audience')
      return {
        groupId: group.id,
        recipients: [{ type: 'GROUP', recipientId: group.id }],
        userIds: [...new Set(group.members.map((member) => member.userId))],
      }
    }
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: audience.userIds },
        workspaceId: principal.workspaceId,
        status: 'ACTIVE',
        companyAccess: { some: { companyId, status: 'ACTIVE' } },
      },
      select: { id: true },
    })
    if (users.length !== audience.userIds.length) throw badRequest('feed_user_audience')
    return {
      groupId: null,
      recipients: users.map((user) => ({ type: 'USER', recipientId: user.id })),
      userIds: users.map((user) => user.id),
    }
  }

  private async expandStoredAudience(
    companyId: string,
    recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>,
  ): Promise<string[]> {
    const userIds = new Set<string>()
    const groupIds = recipients.filter((entry) => entry.type === 'GROUP').map((entry) => entry.recipientId)
    for (const recipient of recipients) {
      if (recipient.type === 'USER') userIds.add(recipient.recipientId)
      if (recipient.type === 'COMPANY') {
        for (const userId of await this.activeCompanyUserIds(companyId)) userIds.add(userId)
      }
    }
    if (groupIds.length > 0) {
      const members = await this.prisma.groupMember.findMany({
        where: { groupId: { in: groupIds }, leftAt: null },
        select: { userId: true },
      })
      for (const member of members) userIds.add(member.userId)
    }
    return [...userIds]
  }

  private async activeCompanyUserIds(companyId: string): Promise<string[]> {
    const access = await this.prisma.userCompanyAccess.findMany({
      where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      select: { userId: true },
    })
    return access.map((entry) => entry.userId)
  }

  private assertMentions(mentionedUserIds: string[], audienceUserIds: string[], authorId: string): void {
    const allowed = new Set([...audienceUserIds, authorId])
    if (mentionedUserIds.some((userId) => !allowed.has(userId))) throw badRequest('feed_mention_outside_audience')
  }

  private async toEntries(
    principal: AuthPrincipal,
    items: ListedFeedItem[],
  ): Promise<FeedEntryView[]> {
    const postViews = await this.toViews(principal, items.filter((item) => item.post !== null))
    const sourceViews = await this.toSourceViews(principal, items.filter((item) => item.post === null))
    const byItemId = new Map<string, FeedEntryView>([
      ...postViews.map((view) => [view.itemId, view] as const),
      ...sourceViews.map((view) => [view.itemId, view] as const),
    ])
    return items.flatMap<FeedEntryView>((item): FeedEntryView[] => {
      const view = byItemId.get(item.id)
      return view ? [view] : []
    })
  }

  private async toSourceViews(
    principal: AuthPrincipal,
    items: ListedFeedItem[],
  ): Promise<FeedSourceView[]> {
    if (items.length === 0) return []
    const taskIds = items.filter((item) => item.sourceType === 'TASK').map((item) => item.sourceId)
    const eventIds = items.filter((item) => item.sourceType === 'EVENT').map((item) => item.sourceId)
    const announcementIds = items
      .filter((item) => item.sourceType === 'ANNOUNCEMENT')
      .map((item) => item.sourceId)
    const fileShareIds = items
      .filter((item) => item.sourceType === 'FILE')
      .map((item) => item.sourceId)
    const [tasks, events, announcements, fileShares] = await Promise.all([
      taskIds.length > 0 && principal.permissions.has('tasks.read')
        ? this.prisma.task.findMany({
            where: {
              id: { in: taskIds },
              workspaceId: principal.workspaceId,
              companyId: { in: principal.allowedCompanyIds },
              AND: [
                {
                  OR: [
                    { groupId: null },
                    { group: { members: { some: { userId: principal.userId, leftAt: null } } } },
                  ],
                },
                ...(principal.permissions.has('tasks.manage')
                  ? []
                  : [{
                      OR: [
                        { createdById: principal.userId },
                        { reporterId: principal.userId },
                        {
                          participants: {
                            some: { userId: principal.userId, removedAt: null },
                          },
                        },
                      ],
                    }]),
              ],
            },
            include: {
              participants: {
                where: {
                  role: 'RESPONSIBLE',
                  removedAt: null,
                },
                include: {
                  user: {
                    select: {
                      id: true,
                      displayName: true,
                      avatarAsset: true,
                    },
                  },
                },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              },
            },
          })
        : Promise.resolve([]),
      eventIds.length > 0 && principal.permissions.has('calendar.read')
        ? this.prisma.event.findMany({
            where: {
              id: { in: eventIds },
              workspaceId: principal.workspaceId,
              companyId: { in: principal.allowedCompanyIds },
              OR: [
                { ownerId: principal.userId },
                { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } },
              ],
            },
          })
        : Promise.resolve([]),
      announcementIds.length > 0 && principal.permissions.has('announcements.read')
        ? this.prisma.announcement.findMany({
            where: {
              id: { in: announcementIds },
              workspaceId: principal.workspaceId,
              status: { in: ['PUBLISHED', 'SCHEDULED'] },
              receipts: { some: { userId: principal.userId } },
            },
          })
        : Promise.resolve([]),
      fileShareIds.length > 0 && principal.permissions.has('documents.read')
        ? this.prisma.feedFileShare.findMany({
            where: {
              id: { in: fileShareIds },
              ...this.accessibleFileShareWhere(principal, principal.allowedCompanyIds),
            },
            include: {
              file: true,
              group: { select: { id: true, name: true } },
              directRecipients: { select: { userId: true } },
            },
          })
        : Promise.resolve([]),
    ])
    const userIds = new Set<string>([
      ...items.flatMap((item) => item.actorId ? [item.actorId] : []),
      ...tasks.flatMap((task) => [
        task.createdById,
        task.reporterId,
        ...task.participants.map((participant) => participant.userId),
      ]),
      ...events.map((event) => event.ownerId),
      ...announcements.map((announcement) => announcement.authorId),
    ])
    const users = userIds.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, displayName: true, avatarAsset: true },
        })
      : []
    const userById = new Map(users.map((user) => [user.id, user]))
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const eventById = new Map(events.map((event) => [event.id, event]))
    const announcementById = new Map(announcements.map((announcement) => [announcement.id, announcement]))
    const fileShareById = new Map(fileShares.map((share) => [share.id, share]))

    return items.flatMap<FeedSourceView>((item): FeedSourceView[] => {
      const actor = item.actorId ? userById.get(item.actorId) ?? null : null
      const historical = this.historicalProjection(item.safePayload)
      if (item.sourceType === 'TASK') {
        const task = taskById.get(item.sourceId)
        if (!task) return []
        const assignee = task.participants[0]?.user
        return [{
          kind: 'SOURCE',
          id: task.id,
          itemId: item.id,
          companyId: task.companyId,
          sourceType: 'TASK',
          action: item.action,
          actor,
          label: this.taskProjectionLabel(item.action, historical),
          title: task.title,
          summary: task.description.trim(),
          metadata: [
            task.number,
            this.taskStatusLabel(task.status),
            ...(assignee ? [`Відповідальна людина: ${assignee.displayName}`] : []),
            ...(task.dueAt ? [`Строк: ${this.formatFeedDate(task.dueAt)}`] : []),
          ],
          href: `/tasks/${encodeURIComponent(task.id)}?company=${encodeURIComponent(task.companyId)}`,
          actionState: 'AVAILABLE',
          occurredAt: item.occurredAt.toISOString(),
          historical,
          favoritedByMe: item.userStates.some((state) => state.favoritedAt !== null),
          version: item.sourceVersion,
          canRevoke: false,
        } satisfies FeedSourceView]
      }
      if (item.sourceType === 'EVENT') {
        const event = eventById.get(item.sourceId)
        if (!event) return []
        const date = event.startAt.toISOString().slice(0, 10)
        return [{
          kind: 'SOURCE',
          id: event.id,
          itemId: item.id,
          companyId: event.companyId,
          sourceType: 'EVENT',
          action: item.action,
          actor,
          label: historical ? 'Історична подія' : 'Подія календаря',
          title: event.title,
          summary: event.allDay
            ? 'Подія на весь день'
            : `${this.formatFeedDate(event.startAt)} — ${this.formatFeedDate(event.endAt)}`,
          metadata: [event.allDay ? 'Увесь день' : event.sourceTimezone],
          href: `/calendar/events/${encodeURIComponent(event.id)}?company=${encodeURIComponent(event.companyId)}&date=${date}`,
          actionState: 'AVAILABLE',
          occurredAt: item.occurredAt.toISOString(),
          historical,
          favoritedByMe: item.userStates.some((state) => state.favoritedAt !== null),
          version: item.sourceVersion,
          canRevoke: false,
        } satisfies FeedSourceView]
      }
      if (item.sourceType === 'ANNOUNCEMENT') {
        const announcement = announcementById.get(item.sourceId)
        if (!announcement) return []
        return [{
          kind: 'SOURCE',
          id: announcement.id,
          itemId: item.id,
          companyId: item.companyId,
          sourceType: 'ANNOUNCEMENT',
          action: item.action,
          actor,
          label: historical ? 'Історичне оголошення' : 'Оголошення',
          title: announcement.title,
          summary: announcement.body.slice(0, 300),
          metadata: [announcement.isPinned ? 'Закріплено' : 'Для вашої аудиторії'],
          href: `/announcements/${encodeURIComponent(announcement.id)}?company=${encodeURIComponent(item.companyId)}`,
          actionState: 'AVAILABLE',
          occurredAt: item.occurredAt.toISOString(),
          historical,
          favoritedByMe: item.userStates.some((state) => state.favoritedAt !== null),
          version: item.sourceVersion,
          canRevoke: false,
        } satisfies FeedSourceView]
      }
      if (item.sourceType === 'FILE') {
        const share = fileShareById.get(item.sourceId)
        if (!share) return []
        const actionState = this.fileActionState(share.file.scanStatus)
        return [{
          kind: 'SOURCE',
          id: share.id,
          itemId: item.id,
          companyId: share.companyId,
          sourceType: 'FILE',
          action: item.action,
          actor,
          label: 'Файл для команди',
          title: share.file.safeFilename,
          summary: this.fileShareSummary(actionState),
          metadata: [
            this.formatFileBytes(share.file.bytes),
            share.file.detectedMime ?? share.file.declaredMime,
            this.fileAudienceLabel(share),
          ],
          href: `/api/v1/files/${encodeURIComponent(share.fileId)}/download`,
          actionState,
          occurredAt: item.occurredAt.toISOString(),
          historical: false,
          favoritedByMe: item.userStates.some((state) => state.favoritedAt !== null),
          version: share.version,
          canRevoke: principal.permissions.has('documents.share')
            && (share.ownerId === principal.userId || principal.permissions.has('feed.moderate')),
        } satisfies FeedSourceView]
      }
      return []
    })
  }

  private async toViews(
    principal: AuthPrincipal,
    items: ListedFeedItem[],
  ): Promise<FeedPostView[]> {
    const posts = items.flatMap((item) => item.post ? [item.post] : [])
    if (posts.length === 0) return []
    const postIds = posts.map((post) => post.id)
    const directUserIds = posts.flatMap((post) =>
      post.recipients.filter((entry) => entry.type === 'USER').map((entry) => entry.recipientId),
    )
    const [comments, directUsers, fileLinks] = await Promise.all([
      this.prisma.comment.findMany({
        where: { entityType: 'FEED_POST', entityId: { in: postIds }, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      directUserIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: [...new Set(directUserIds)] } },
            select: { id: true, displayName: true },
          })
        : Promise.resolve([]),
      this.prisma.fileLink.findMany({
        where: {
          entityType: 'FEED_POST',
          entityId: { in: postIds },
          purpose: 'ATTACHMENT',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ])
    const [commentAuthors, files] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(comments.map((comment) => comment.authorId))] } },
        select: { id: true, displayName: true, avatarAsset: true },
      }),
      fileLinks.length > 0
        ? this.prisma.fileObject.findMany({
            where: { id: { in: [...new Set(fileLinks.map((link) => link.fileId))] } },
            select: {
              id: true,
              safeFilename: true,
              bytes: true,
              detectedMime: true,
              declaredMime: true,
              scanStatus: true,
            },
          })
        : Promise.resolve([]),
    ])
    const authorById = new Map(commentAuthors.map((author) => [author.id, author]))
    const directNameById = new Map(directUsers.map((user) => [user.id, user.displayName]))
    const fileById = new Map(files.map((file) => [file.id, file]))
    return items.flatMap((item) => {
      const post = item.post
      if (!post) return []
      const currentRecipients = post.acknowledgementRecipients.filter((entry) =>
        entry.acknowledgementVersion === post.acknowledgementVersion)
      const currentAcknowledgements = post.acknowledgements.filter((entry) =>
        entry.acknowledgementVersion === post.acknowledgementVersion)
      const postComments = comments.filter((comment) => comment.entityId === post.id)
      return [{
        kind: 'POST',
        id: post.id,
        itemId: item.id,
        companyId: post.companyId,
        group: post.group,
        author: post.author,
        audienceLabel: this.audienceLabel(post, directNameById),
        body: post.body,
        status: post.status,
        requiresAcknowledgement: post.requiresAcknowledgement,
        acknowledgementVersion: post.acknowledgementVersion,
        acknowledgementRequiredForMe: currentRecipients.some((entry) => entry.userId === principal.userId),
        hasAcknowledged: currentAcknowledgements.some((entry) => entry.userId === principal.userId),
        acknowledgementCount: currentAcknowledgements.length,
        acknowledgementRecipientCount: currentRecipients.length,
        likedByMe: post.reactions.some((reaction) =>
          reaction.userId === principal.userId && reaction.kind === 'LIKE'),
        likeCount: post.reactions.filter((reaction) => reaction.kind === 'LIKE').length,
        commentCount: postComments.length,
        comments: postComments.map((comment) => ({
          id: comment.id,
          author: authorById.get(comment.authorId) ?? {
            id: comment.authorId,
            displayName: 'Недоступний користувач',
            avatarAsset: null,
          },
          body: comment.body,
          replyToCommentId: comment.replyToCommentId,
          createdAt: comment.createdAt.toISOString(),
          editedAt: comment.editedAt?.toISOString() ?? null,
        })),
        attachments: fileLinks
          .filter((link) => link.entityId === post.id)
          .flatMap((link) => {
            const file = fileById.get(link.fileId)
            return file ? [{
              id: file.id,
              fileName: file.safeFilename,
              bytes: file.bytes,
              mimeType: file.detectedMime ?? file.declaredMime,
              scanStatus: file.scanStatus,
            }] : []
          }),
        subscriptionMode: this.subscriptionMode(
          post.subscriptions.find((subscription) => subscription.userId === principal.userId)?.mode,
        ),
        favoritedByMe: item.userStates.some((state) => state.favoritedAt !== null),
        publishedAt: post.publishedAt.toISOString(),
        editedAt: post.editedAt?.toISOString() ?? null,
        version: post.version,
        canEdit: post.authorId === principal.userId || principal.permissions.has('feed.moderate'),
        canModerate: principal.permissions.has('feed.moderate'),
      }]
    })
  }

  private audienceLabel(
    post: {
      group: { name: string } | null
      recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>
    },
    directNameById: Map<string, string>,
  ): string {
    if (post.recipients.some((entry) => entry.type === 'COMPANY')) return 'Вся організація'
    if (post.group) return post.group.name
    const names = post.recipients
      .filter((entry) => entry.type === 'USER')
      .map((entry) => directNameById.get(entry.recipientId) ?? 'Працівник')
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} та ще ${names.length - 2}`
  }

  private subscriptionMode(value: string | undefined): FeedSubscriptionMode {
    return value === 'ALL' || value === 'MENTIONS' ? value : 'NONE'
  }

  private historicalProjection(safePayload: string): boolean {
    try {
      const payload = JSON.parse(safePayload) as { historical?: unknown }
      return payload.historical === true
    } catch {
      return false
    }
  }

  private taskProjectionLabel(action: string, historical: boolean): string {
    if (historical) return 'Історичне завдання'
    if (action === 'BLOCKED') return 'Завдання заблоковано'
    if (action === 'UNBLOCKED') return 'Блокер знято'
    if (action === 'PARTICIPANT_CHANGED') return 'Учасників завдання оновлено'
    return 'Нове призначення'
  }

  private fileActionState(
    scanStatus: string,
  ): FeedSourceView['actionState'] {
    if (scanStatus === 'CLEAN') return 'AVAILABLE'
    if (scanStatus === 'QUARANTINED' || scanStatus === 'SCANNING') return 'PROCESSING'
    return 'BLOCKED'
  }

  private fileShareSummary(actionState: FeedSourceView['actionState']): string {
    if (actionState === 'AVAILABLE') return 'Перевірено та готово до безпечного завантаження.'
    if (actionState === 'PROCESSING') return 'Перевіряємо файл. Завантаження відкриється автоматично після перевірки.'
    return 'Файл заблоковано перевіркою безпеки. Завантаження недоступне.'
  }

  private fileAudienceLabel(share: {
    audienceType: string
    group: { name: string } | null
    directRecipients: Array<{ userId: string }>
  }): string {
    if (share.audienceType === 'COMPANY') return 'Вся організація'
    if (share.audienceType === 'GROUP') return share.group?.name ?? 'Робоча група'
    return share.directRecipients.length === 1
      ? 'Особистий доступ'
      : `Обрані працівники: ${share.directRecipients.length}`
  }

  private formatFileBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  }

  private taskStatusLabel(status: string): string {
    return ({
      NEW: 'Нове',
      PLANNED: 'Заплановано',
      IN_PROGRESS: 'У роботі',
      IN_REVIEW: 'На перевірці',
      DONE: 'Виконано',
      BLOCKED: 'Заблоковано',
      CANCELLED: 'Скасовано',
      ARCHIVED: 'В архіві',
    } as Record<string, string>)[status] ?? status
  }

  private formatFeedDate(value: Date): string {
    return new Intl.DateTimeFormat('uk-UA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Kyiv',
    }).format(value)
  }

  private async pendingAcknowledgementCount(
    principal: AuthPrincipal,
    access: Prisma.FeedPostWhereInput,
  ): Promise<number> {
    const recipients = await this.prisma.feedAcknowledgementRecipient.findMany({
      where: {
        userId: principal.userId,
        post: { is: { ...access, status: 'PUBLISHED' } },
      },
      include: {
        post: { select: { acknowledgementVersion: true } },
      },
    })
    const current = recipients.filter((entry) =>
      entry.acknowledgementVersion === entry.post.acknowledgementVersion)
    if (current.length === 0) return 0
    const acknowledged = await this.prisma.feedPostAcknowledgement.findMany({
      where: {
        userId: principal.userId,
        OR: current.map((entry) => ({
          postId: entry.postId,
          acknowledgementVersion: entry.acknowledgementVersion,
        })),
      },
      select: { postId: true, acknowledgementVersion: true },
    })
    const keys = new Set(acknowledged.map((entry) => `${entry.postId}:${entry.acknowledgementVersion}`))
    return current.filter((entry) => !keys.has(`${entry.postId}:${entry.acknowledgementVersion}`)).length
  }

  private async unreadCount(
    principal: AuthPrincipal,
    companyIds: string[],
    access: Prisma.FeedPostWhereInput,
  ): Promise<number> {
    const cursors = await this.prisma.feedReadCursor.findMany({
      where: { userId: principal.userId, companyId: { in: companyIds } },
    })
    const byCompany = new Map(cursors.map((cursor) => [cursor.companyId, cursor]))
    const positionFilters: Prisma.FeedSourceHeadWhereInput[] = companyIds.map((companyId) => {
      const cursor = byCompany.get(companyId)
      if (!cursor) return { companyId }
      return {
        companyId,
        OR: [
          { occurredAt: { gt: cursor.lastReadOccurredAt } },
          { occurredAt: cursor.lastReadOccurredAt, itemId: { gt: cursor.lastReadItemId } },
        ],
      }
    })
    return this.prisma.feedSourceHead.count({
      where: {
        workspaceId: principal.workspaceId,
        countsAsUnread: true,
        AND: [
          {
            item: {
              is: {
                ...this.feedItemAccessWhere(principal, { ...access, status: 'PUBLISHED' }),
              },
            },
          },
          { OR: positionFilters },
        ],
      },
    })
  }

  private async dateAccessWhere(
    companyIds: string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<Prisma.FeedItemWhereInput | null> {
    if (!dateFrom && !dateTo) return null
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, timezone: true },
    })
    return {
      OR: companies.map((company) => ({
        companyId: company.id,
        occurredAt: {
          ...(dateFrom
            ? { gte: this.zonedDateBoundary(dateFrom, company.timezone, false) }
            : {}),
          ...(dateTo
            ? { lte: this.zonedDateBoundary(dateTo, company.timezone, true) }
            : {}),
        },
      })),
    }
  }

  private zonedDateBoundary(date: string, timeZone: string, endOfDay: boolean): Date {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    const hour = endOfDay ? 23 : 0
    const minute = endOfDay ? 59 : 0
    const second = endOfDay ? 59 : 0
    const desired = Date.UTC(year, month - 1, day, hour, minute, second)
    let candidate = desired
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate))
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, Number(part.value)]),
      ) as Record<string, number>
      const represented = Date.UTC(
        parts.year ?? year,
        (parts.month ?? month) - 1,
        parts.day ?? day,
        parts.hour ?? hour,
        parts.minute ?? minute,
        parts.second ?? second,
      )
      const adjustment = desired - represented
      candidate += adjustment
      if (adjustment === 0) break
    }
    return new Date(candidate + (endOfDay ? 999 : 0))
  }

  private itemData(
    principal: AuthPrincipal,
    input: {
      id: string
      postId: string
      companyId: string
      sourceVersion: number
      action: string
      body: string
      occurredAt: Date
      visibility: string
    },
  ) {
    return {
      id: input.id,
      workspaceId: principal.workspaceId,
      companyId: input.companyId,
      postId: input.postId,
      sourceType: 'POST',
      sourceId: input.postId,
      sourceVersion: input.sourceVersion,
      action: input.action,
      eventKey: `feed:post:${input.postId}:v${input.sourceVersion}:${input.action.toLowerCase()}`,
      actorId: principal.userId,
      visibility: input.visibility,
      safePayload: JSON.stringify({
        postId: input.postId,
        action: input.action,
        snippet: input.body.slice(0, 240),
      }),
      countsAsUnread: true,
      occurredAt: input.occurredAt,
    }
  }

  private auditData(
    principal: AuthPrincipal,
    companyId: string,
    action: string,
    entityId: string,
    safeDiff: Record<string, unknown>,
  ) {
    return {
      id: id('aud'),
      workspaceId: principal.workspaceId,
      companyId,
      actorType: 'USER',
      actorId: principal.userId,
      action,
      entityType: 'FEED_POST',
      entityId,
      result: 'SUCCESS',
      risk: 'NORMAL',
      safeDiffJson: JSON.stringify(safeDiff),
      correlationId: id('corr'),
    }
  }

  private encodeCursor(cursor: FeedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(value: string): FeedCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FeedCursor>
      if (!parsed.id || !parsed.occurredAt || Number.isNaN(Date.parse(parsed.occurredAt))) {
        throw new Error('invalid')
      }
      return { id: parsed.id, occurredAt: parsed.occurredAt }
    } catch {
      throw badRequest('feed_cursor_invalid')
    }
  }

  private comparePosition(left: FeedCursor, right: FeedCursor): number {
    const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    return time === 0 ? left.id.localeCompare(right.id) : time
  }
}
