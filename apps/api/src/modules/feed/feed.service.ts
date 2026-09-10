import { Injectable } from '@nestjs/common'
import {
  type CreateFeedCommentInput,
  type CreateFeedPostInput,
  type FeedAudienceOption,
  type FeedAudienceFacetOption,
  type FeedAuthorOption,
  type FeedBirthdayView,
  type FeedEntryView,
  type FeedListQuery,
  type FeedListResult,
  type FeedMentionCandidatesQuery,
  type FeedPostView,
  type FeedSourceView,
  type MarkFeedReadInput,
  type MentionCandidateView,
  type MentionSearchQuery,
  type ShareFileToFeedInput,
  type UpdateFeedPostInput,
  type StructuredMentionInput,
  type StructuredMentionView,
} from '@bert-crm/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { normalizeUserSearchValue } from '../../common/user-search.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { ChatRealtimeService } from '../communication/chat-realtime.service.js'
import {
  advanceFeedSourceHead,
  writeFeedProjection,
} from './feed-projection.service.js'
import { calendarDateInTimeZone, daysUntilBirthday } from './birthday-highlight.js'

interface FeedCursor {
  occurredAt: string
  id: string
}

interface ResolvedAudience {
  groupId: string | null
  recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>
  userIds: string[]
  companyIds: string[]
}

type ListedFeedItem = Prisma.FeedItemGetPayload<{
  include: {
    post: {
      include: {
        author: { select: { id: true; displayName: true; avatarAsset: true } }
        group: { select: { id: true; name: true } }
        recipients: true
        acknowledgementRecipients: true
        acknowledgements: true
        reactions: true
      }
    }
  }
}>

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly files: FilesService,
    private readonly realtime?: ChatRealtimeService,
  ) {}

  async uploadAttachment(
    principal: AuthPrincipal,
    companyId: string,
    file: UploadedBinary,
  ) {
    return this.files.upload(principal, this.scope.assertCompany(principal, companyId), file)
  }

  async shareFile(
    principal: AuthPrincipal,
    fileId: string,
    input: ShareFileToFeedInput,
    idempotencyKey: string,
  ): Promise<{ id: string; fileId: string; version: number; status: 'ACTIVE' }> {
    this.scope.assertCompany(principal, input.companyId)
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
          audienceType: input.audience.type === 'USERS'
            ? 'USER'
            : input.audience.type === 'COMPANIES'
              ? 'COMPANY'
              : input.audience.type,
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
    this.realtime?.publishSummary(audience.userIds, ['feed'])
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
    if (share.ownerId !== principal.userId && !isGlobalAdmin(principal)) throw notFound()
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
    const companyIds = this.scope.allowedCompanies(principal, company)
    if (companyIds.length === 0) return { items: [] }
    const [companies, groups] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds }, workspaceId: principal.workspaceId, isActive: true },
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

  async mentionCandidates(
    principal: AuthPrincipal,
    query: FeedMentionCandidatesQuery,
  ): Promise<{ items: MentionCandidateView[] }> {
    if (query.company === 'all') throw badRequest('company_required')
    this.scope.assertCompany(principal, query.company)
    const audience = await this.resolveAudience(principal, query.company, query.audienceType === 'GROUP'
      ? { type: 'GROUP', groupId: query.audienceId! }
      : { type: 'COMPANY' })
    return {
      items: await this.findMentionCandidates(
        principal,
        query.company,
        [...new Set([...audience.userIds, principal.userId])],
        query.q,
        query.limit,
      ),
    }
  }

  async postMentionCandidates(
    principal: AuthPrincipal,
    postId: string,
    query: MentionSearchQuery,
  ): Promise<{ items: MentionCandidateView[] }> {
    const post = await this.accessiblePost(principal, postId)
    const audienceUserIds = await this.expandStoredAudience(post.companyId, post.recipients)
    return {
      items: await this.findMentionCandidates(
        principal,
        post.companyId,
        [...new Set([...audienceUserIds, post.authorId])],
        query.q,
        query.limit,
      ),
    }
  }

  private async findMentionCandidates(
    principal: AuthPrincipal,
    companyId: string,
    allowedUserIds: string[],
    search: string,
    limit: number,
  ): Promise<MentionCandidateView[]> {
    if (allowedUserIds.length === 0) return []
    const normalized = normalizeUserSearchValue(search)
    return this.prisma.user.findMany({
      where: {
        id: { in: allowedUserIds },
        workspaceId: principal.workspaceId,
        isActive: true,
        OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }],
        ...(normalized
          ? {
              AND: [{
                OR: [
                  { normalizedDisplayName: { contains: normalized } },
                  { normalizedUsername: { contains: normalized } },
                ],
              }],
            }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        jobTitle: true,
        avatarAsset: true,
      },
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
      take: limit,
    })
  }

  async audienceFacets(
    principal: AuthPrincipal,
    company?: string,
  ): Promise<{ items: FeedAudienceFacetOption[] }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    if (companyIds.length === 0) return { items: [] }
    const access = await this.accessiblePostWhere(principal, companyIds)
    const fileShareAccess = this.accessibleFileShareWhere(principal, companyIds)
    const [companies, groupRecipients, userRecipients, fileGroupShares, fileUserRecipients] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds }, workspaceId: principal.workspaceId, isActive: true },
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
      this.prisma.feedFileShare.findMany({
            where: {
              ...fileShareAccess,
              audienceType: 'GROUP',
              groupId: { not: null },
            },
            distinct: ['groupId'],
            select: { groupId: true },
          }),
      this.prisma.feedFileShareRecipient.groupBy({
            by: ['userId'],
            where: { share: { is: fileShareAccess } },
          }),
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
              isActive: true,
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
    const companyIds = this.scope.allowedCompanies(principal, company)
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
              post: {
                include: {
                  author: { select: { id: true, displayName: true, avatarAsset: true } },
                  group: { select: { id: true, name: true } },
                  recipients: true,
                  acknowledgementRecipients: true,
                  acknowledgements: true,
                  reactions: true,
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
    const companyIds = this.scope.allowedCompanies(principal, query.company)
    if (companyIds.length === 0) {
      return {
        items: [],
        birthdays: [],
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
            post: {
              include: {
                author: { select: { id: true, displayName: true, avatarAsset: true } },
                group: { select: { id: true, name: true } },
                recipients: true,
                acknowledgementRecipients: true,
                acknowledgements: true,
                reactions: true,
              },
            },
          },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { itemId: 'desc' }],
      take: scanLimit,
    })
    const currentItems: ListedFeedItem[] = []
    const seenPostIds = new Set<string>()
    for (const { item } of rawHeads) {
      if (item.post) {
        if (seenPostIds.has(item.post.id)) continue
        seenPostIds.add(item.post.id)
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
    const [pendingAcknowledgements, overdueTasks, unreadCount, birthdays] = await Promise.all([
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
      this.birthdayHighlights(principal, companyIds, query),
    ])
    const readMarkers = new Map<string, string>()
    // Advance the read marker for every accessible company in the scanned set.
    // Iterate the raw per-company heads rather than the rendered page or the
    // post-deduplicated list: a post addressed to several companies keeps only
    // one company's FeedItem after `seenPostIds` de-duplication, and a company
    // whose newest head sits past the first rendered page never reaches `page`.
    // Either gap leaves that company's read cursor un-advanced, so its unread
    // contribution can never be cleared just by opening the feed. Every entry in
    // `rawHeads` already passed the same access filter that `markRead` re-checks.
    for (const head of rawHeads) {
      if (!readMarkers.has(head.companyId)) readMarkers.set(head.companyId, head.itemId)
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
      birthdays,
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

  async summary(principal: AuthPrincipal, company?: string): Promise<{ unreadCount: number }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    if (companyIds.length === 0) return { unreadCount: 0 }
    const access = await this.accessiblePostWhere(principal, companyIds)
    return { unreadCount: await this.unreadCount(principal, companyIds, access) }
  }

  async detail(principal: AuthPrincipal, postId: string): Promise<FeedPostView> {
    const post = await this.accessiblePost(principal, postId)
    const item = await this.prisma.feedItem.findFirst({
      where: { postId: post.id, sourceHead: { isNot: null } },
      include: {
        post: {
          include: {
            author: { select: { id: true, displayName: true, avatarAsset: true } },
            group: { select: { id: true, name: true } },
            recipients: true,
            acknowledgementRecipients: true,
            acknowledgements: true,
            reactions: true,
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
    const mentionedUserIds = [...new Set([
      ...input.mentionedUserIds,
      ...this.validateStructuredMentions(input.body, input.mentions),
    ])]
    this.assertMentions(mentionedUserIds, audience.userIds, principal.userId)
    await this.files.assertAttachable(principal, input.companyId, input.attachmentIds)
    const postId = id('feed')
    const itemIds = audience.companyIds.map((companyId) => ({ companyId, itemId: id('fitem') }))
    const now = new Date()
    const acknowledgementVersion = input.requiresAcknowledgement ? 1 : 0
    const acknowledgementUserIds = input.requiresAcknowledgement
      ? audience.userIds.filter((userId) => userId !== principal.userId)
      : []
    const notificationUserIds = [
      ...new Set([
        ...acknowledgementUserIds,
        ...mentionedUserIds.filter((userId) => userId !== principal.userId),
      ]),
    ]
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
      for (const { companyId, itemId } of itemIds) {
        await tx.feedItem.create({
          data: this.itemData(principal, {
            id: itemId,
            postId,
            companyId,
            sourceVersion: 1,
            action: 'PUBLISHED',
            body: input.body,
            occurredAt: now,
            visibility: input.audience.type,
          }),
        })
        await advanceFeedSourceHead(tx, {
          workspaceId: principal.workspaceId,
          companyId,
          sourceType: 'POST',
          sourceId: postId,
          itemId,
          sourceVersion: 1,
          countsAsUnread: true,
          occurredAt: now,
        })
      }
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
      if (mentionedUserIds.length > 0) {
        await tx.feedMention.createMany({
          data: mentionedUserIds.map((userId) => ({
            id: id('fmt'),
            postId,
            userId,
          })),
        })
      }
      if (input.mentions.length > 0) {
        await tx.contentMention.createMany({
          data: input.mentions.map((mention) => ({
            id: id('mnt'),
            workspaceId: principal.workspaceId,
            sourceType: 'FEED_POST',
            sourceId: postId,
            ...mention,
          })),
        })
      }
      await tx.feedSubscription.createMany({
        data: [...new Set([principal.userId, ...mentionedUserIds])].map((userId) => ({
          id: id('fsub'),
          postId,
          userId,
          mode: userId === principal.userId ? 'ALL' : 'MENTIONS',
        })),
      })
      const acknowledgementUsers = new Set(acknowledgementUserIds)
      for (const userId of notificationUserIds) {
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
          safePayload: JSON.stringify({ postId, companyIds: audience.companyIds, itemIds: itemIds.map((item) => item.itemId) }),
        },
      })
    })
    this.realtime?.publishSummary(audience.userIds, ['feed'])
    this.realtime?.publishSummary(notificationUserIds, ['notifications'])
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
    const synchronizesMentions = input.mentions !== undefined || input.mentionedUserIds !== undefined
    const storedAudienceUserIds = post.requiresAcknowledgement || synchronizesMentions
      ? await this.expandStoredAudience(post.companyId, post.recipients)
      : []
    const audienceUserIds = post.requiresAcknowledgement
      ? storedAudienceUserIds.filter((userId) => userId !== post.authorId)
      : []
    const nextStructuredMentions = input.mentions ?? []
    const nextMentionedUserIds = synchronizesMentions
      ? [...new Set([
          ...(input.mentionedUserIds ?? []),
          ...this.validateStructuredMentions(input.body, nextStructuredMentions),
        ])]
      : []
    if (synchronizesMentions) {
      this.assertMentions(nextMentionedUserIds, storedAudienceUserIds, post.authorId)
    }
    const previousMentionedUserIds = synchronizesMentions
      ? await this.prisma.feedMention.findMany({
          where: { postId, commentId: null },
          select: { userId: true },
        })
      : []
    const previousMentioned = new Set(previousMentionedUserIds.map((mention) => mention.userId))
    const newlyMentionedUserIds = nextMentionedUserIds.filter((userId) => !previousMentioned.has(userId))
    const feedRecipientIds = storedAudienceUserIds.length > 0
      ? storedAudienceUserIds
      : await this.expandStoredAudience(post.companyId, post.recipients)
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
      await tx.contentMention.deleteMany({
        where: { workspaceId: principal.workspaceId, sourceType: 'FEED_POST', sourceId: postId },
      })
      if (synchronizesMentions) {
        await tx.feedMention.deleteMany({ where: { postId, commentId: null } })
        if (nextMentionedUserIds.length > 0) {
          await tx.feedMention.createMany({
            data: nextMentionedUserIds.map((userId) => ({
              id: id('fmt'),
              postId,
              userId,
            })),
          })
        }
        if (nextStructuredMentions.length > 0) {
          await tx.contentMention.createMany({
            data: nextStructuredMentions.map((mention) => ({
              id: id('mnt'),
              workspaceId: principal.workspaceId,
              sourceType: 'FEED_POST',
              sourceId: postId,
              ...mention,
            })),
          })
        }
        for (const userId of nextMentionedUserIds) {
          await tx.feedSubscription.upsert({
            where: { postId_userId: { postId, userId } },
            create: { id: id('fsub'), postId, userId, mode: 'MENTIONS' },
            update: {},
          })
        }
        for (const userId of newlyMentionedUserIds) {
          if (userId === principal.userId) continue
          const dedupeKey = `feed-post:${postId}:mention:v${nextVersion}:${userId}`
          await tx.notification.upsert({
            where: { dedupeKey },
            create: {
              id: id('ntf'),
              recipientId: userId,
              category: 'MENTION',
              safeTitle: 'Вас згадали у публікації',
              safeSnippet: 'Відкрийте стрічку, щоб переглянути згадку.',
              entityType: 'FEED_POST',
              entityId: postId,
              requiresAction: false,
              deliveredAt: now,
              dedupeKey,
            },
            update: {},
          })
        }
      }
      await tx.auditEvent.create({
        data: this.auditData(principal, post.companyId, 'feed.post.edited', postId, {
          version: { from: post.version, to: nextVersion },
          acknowledgementVersion: { from: post.acknowledgementVersion, to: nextAcknowledgementVersion },
          ...(synchronizesMentions
            ? { mentionCount: nextMentionedUserIds.length, newlyMentionedCount: newlyMentionedUserIds.length }
            : {}),
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
    this.realtime?.publishSummary(feedRecipientIds, ['feed'])
    this.realtime?.publishSummary(
      newlyMentionedUserIds.filter((userId) => userId !== principal.userId),
      ['notifications'],
    )
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
    const feedRecipientIds = await this.expandStoredAudience(post.companyId, post.recipients)
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
    this.realtime?.publishSummary(feedRecipientIds, ['feed'])
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
    const mentionedUserIds = [...new Set([
      ...input.mentionedUserIds,
      ...this.validateStructuredMentions(input.body, input.mentions),
    ])]
    this.assertMentions(mentionedUserIds, audienceUserIds, principal.userId)
    const activeNotificationUsers = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set([...audienceUserIds, post.authorId])] },
        isActive: true,
        OR: [{ primaryCompanyId: post.companyId }, { accountType: 'ADMIN' }],
      },
      select: { id: true },
    })
    const activeNotificationUserIds = activeNotificationUsers.map((user) => user.id)
    const notificationUserIds: string[] = []
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
      if (mentionedUserIds.length > 0) {
        await tx.feedMention.createMany({
          data: mentionedUserIds.map((userId) => ({
            id: id('fmt'),
            postId,
            commentId,
            userId,
          })),
        })
      }
      if (input.mentions.length > 0) {
        await tx.contentMention.createMany({
          data: input.mentions.map((mention) => ({
            id: id('mnt'),
            workspaceId: principal.workspaceId,
            sourceType: 'FEED_COMMENT',
            sourceId: commentId,
            ...mention,
          })),
        })
      }
      await tx.feedSubscription.upsert({
        where: { postId_userId: { postId, userId: principal.userId } },
        create: { id: id('fsub'), postId, userId: principal.userId, mode: 'ALL' },
        update: {},
      })
      for (const userId of mentionedUserIds) {
        await tx.feedSubscription.upsert({
          where: { postId_userId: { postId, userId } },
          create: { id: id('fsub'), postId, userId, mode: 'MENTIONS' },
          update: {},
        })
      }
      const mentioned = new Set(mentionedUserIds)
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
        notificationUserIds.push(subscription.userId)
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
    this.realtime?.publishSummary(notificationUserIds, ['notifications'])
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
      this.scope.assertCompany(principal, marker.companyId)
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
    const result = await this.prisma.$transaction(async (tx) => {
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
    if (result.updated > 0) this.realtime?.publishSummary([principal.userId], ['feed'])
    return result
  }

  private async accessiblePost(principal: AuthPrincipal, postId: string) {
    const companyIds = this.scope.allowedCompanies(principal, 'all')
    const candidate = await this.prisma.feedPost.findFirst({
      where: {
        id: postId,
        workspaceId: principal.workspaceId,
        OR: [
          { companyId: { in: companyIds } },
          { recipients: { some: { type: 'COMPANY', recipientId: { in: companyIds } } } },
        ],
      },
      select: { companyId: true },
    })
    if (!candidate) throw notFound()
    const access = await this.accessiblePostWhere(principal, companyIds)
    const post = await this.prisma.feedPost.findFirst({
      where: { id: postId, status: 'PUBLISHED', ...access },
      include: { recipients: true },
    })
    if (!post) throw notFound()
    return post
  }

  private async editablePost(principal: AuthPrincipal, postId: string) {
    const post = await this.accessiblePost(principal, postId)
    if (post.authorId !== principal.userId && !isGlobalAdmin(principal)) throw notFound()
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
      && !query.mentioned
      && !query.important
    ) {
      const actorFilter = query.authorId ?? (query.filter === 'MINE' ? principal.userId : null)
      if (!query.groupId && !query.audienceId && allows('TASK')) {
        branches.push({
          postId: null,
          sourceType: 'TASK',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            ...(isGlobalAdmin(principal)
              ? []
              : [{ recipients: { some: { userId: principal.userId } } }]),
          ],
        })
      }
      if (!query.groupId && !query.audienceId && allows('EVENT')) {
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
      if (!query.groupId && !query.audienceId && allows('ANNOUNCEMENT')) {
        branches.push({
          postId: null,
          sourceType: 'ANNOUNCEMENT',
          AND: [
            ...(actorFilter ? [{ actorId: actorFilter }] : []),
            { recipients: { some: { userId: principal.userId } } },
          ],
        })
      }
      if (allows('FILE')) {
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
        companyIds: [companyId],
      }
    }
    if (audience.type === 'GROUP') {
      const group = await this.prisma.group.findFirst({
        where: {
          id: audience.groupId,
          workspaceId: principal.workspaceId,
          companyId,
          status: 'ACTIVE',
          ...(isGlobalAdmin(principal)
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
        companyIds: [companyId],
      }
    }
    if (audience.type === 'COMPANIES') {
      if (!audience.companyIds.includes(companyId)) throw badRequest('feed_company_audience')
      const companyIds = [...new Set(audience.companyIds)]
      const allowed = this.scope.allowedCompanies(principal, 'all')
      if (companyIds.some((id) => !allowed.includes(id))) throw badRequest('feed_company_audience')
      const userIds = (await Promise.all(companyIds.map((id) => this.activeCompanyUserIds(id)))).flat()
      return {
        groupId: null,
        recipients: companyIds.map((id) => ({ type: 'COMPANY' as const, recipientId: id })),
        userIds: [...new Set(userIds)],
        companyIds,
      }
    }
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: audience.userIds },
        workspaceId: principal.workspaceId,
        isActive: true,
        OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }],
      },
      select: { id: true },
    })
    if (users.length !== audience.userIds.length) throw badRequest('feed_user_audience')
    return {
      groupId: null,
      recipients: users.map((user) => ({ type: 'USER', recipientId: user.id })),
      userIds: users.map((user) => user.id),
      companyIds: [companyId],
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
        for (const userId of await this.activeCompanyUserIds(recipient.recipientId)) userIds.add(userId)
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
    const users = await this.prisma.user.findMany({
      where: { primaryCompanyId: companyId, isActive: true },
      select: { id: true },
    })
    return users.map((user) => user.id)
  }

  private validateStructuredMentions(body: string, mentions: StructuredMentionInput[]): string[] {
    const ordered = mentions.toSorted((left, right) => left.start - right.start || left.end - right.end)
    let previousEnd = 0
    for (const mention of ordered) {
      if (
        mention.start < previousEnd
        || mention.end > body.length
        || body.slice(mention.start, mention.end) !== `@${mention.label}`
      ) {
        throw badRequest('feed_mention_invalid')
      }
      previousEnd = mention.end
    }
    return [...new Set(ordered.map((mention) => mention.userId))]
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
      taskIds.length > 0
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
                ...(isGlobalAdmin(principal)
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
      eventIds.length > 0
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
      announcementIds.length > 0
        ? this.prisma.announcement.findMany({
            where: {
              id: { in: announcementIds },
              workspaceId: principal.workspaceId,
              status: { in: ['PUBLISHED', 'SCHEDULED'] },
              receipts: { some: { userId: principal.userId } },
            },
          })
        : Promise.resolve([]),
      fileShareIds.length > 0
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
          version: share.version,
          canRevoke: share.ownerId === principal.userId || isGlobalAdmin(principal),
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
    const companyRecipientIds = posts.flatMap((post) =>
      post.recipients.filter((entry) => entry.type === 'COMPANY').map((entry) => entry.recipientId),
    )
    const [comments, directUsers, fileLinks, companyRecipients, totalActiveCompanies] = await Promise.all([
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
      companyRecipientIds.length > 0
        ? this.prisma.company.findMany({
            where: { id: { in: [...new Set(companyRecipientIds)] } },
            select: { id: true, displayName: true },
          })
        : Promise.resolve([]),
      this.prisma.company.count({ where: { workspaceId: principal.workspaceId, isActive: true } }),
    ])
    const [commentAuthors, files, contentMentions] = await Promise.all([
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
      this.prisma.contentMention.findMany({
        where: {
          workspaceId: principal.workspaceId,
          OR: [
            { sourceType: 'FEED_POST', sourceId: { in: postIds } },
            { sourceType: 'FEED_COMMENT', sourceId: { in: comments.map((comment) => comment.id) } },
          ],
        },
        orderBy: [{ sourceType: 'asc' }, { sourceId: 'asc' }, { start: 'asc' }],
      }),
    ])
    const mentionUsers = contentMentions.length > 0
      ? await this.prisma.user.findMany({
          where: {
            id: { in: [...new Set(contentMentions.map((mention) => mention.userId))] },
            workspaceId: principal.workspaceId,
          },
          select: { id: true, primaryCompanyId: true, accountType: true, isActive: true },
        })
      : []
    const authorById = new Map(commentAuthors.map((author) => [author.id, author]))
    const mentionUserById = new Map(mentionUsers.map((user) => [user.id, user]))
    const directNameById = new Map(directUsers.map((user) => [user.id, user.displayName]))
    const companyNameById = new Map(companyRecipients.map((company) => [company.id, company.displayName]))
    const fileById = new Map(files.map((file) => [file.id, file]))
    const mentionsFor = (
      sourceType: 'FEED_POST' | 'FEED_COMMENT',
      sourceId: string,
      companyId: string,
    ): StructuredMentionView[] => contentMentions
      .filter((mention) => mention.sourceType === sourceType && mention.sourceId === sourceId)
      .map((mention) => {
        const user = mentionUserById.get(mention.userId)
        return {
          userId: mention.userId,
          start: mention.start,
          end: mention.end,
          active: Boolean(user?.isActive && (
            user.primaryCompanyId === companyId || user.accountType === 'ADMIN'
          )),
        }
      })
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
        audienceLabel: this.audienceLabel(post, directNameById, companyNameById, totalActiveCompanies),
        body: post.body,
        mentions: mentionsFor('FEED_POST', post.id, post.companyId),
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
          mentions: mentionsFor('FEED_COMMENT', comment.id, post.companyId),
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
        publishedAt: post.publishedAt.toISOString(),
        editedAt: post.editedAt?.toISOString() ?? null,
        version: post.version,
        canEdit: post.authorId === principal.userId || isGlobalAdmin(principal),
        canModerate: isGlobalAdmin(principal),
      }]
    })
  }

  private audienceLabel(
    post: {
      group: { name: string } | null
      recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>
    },
    directNameById: Map<string, string>,
    companyNameById: Map<string, string>,
    totalActiveCompanies: number,
  ): string {
    const companyRecipientIds = post.recipients
      .filter((entry) => entry.type === 'COMPANY')
      .map((entry) => entry.recipientId)
    if (companyRecipientIds.length > 1) {
      return companyRecipientIds.length >= totalActiveCompanies
        ? 'Всім співробітникам'
        : companyRecipientIds.map((companyId) => companyNameById.get(companyId) ?? 'Компанія').join(', ')
    }
    if (companyRecipientIds.length === 1) return 'Вся організація'
    if (post.group) return post.group.name
    return post.recipients
      .filter((entry) => entry.type === 'USER')
      .map((entry) => directNameById.get(entry.recipientId) ?? 'Працівник')
      .join(', ')
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

  private async birthdayHighlights(
    principal: AuthPrincipal,
    companyIds: string[],
    query: FeedListQuery,
  ): Promise<FeedBirthdayView[]> {
    if (!this.isDefaultFeedPage(query) || companyIds.length !== 1) return []
    const company = await this.prisma.company.findFirst({
      where: {
        id: companyIds[0],
        workspaceId: principal.workspaceId,
        isActive: true,
      },
      select: { id: true, timezone: true },
    })
    if (!company) return []
    const today = calendarDateInTimeZone(new Date(), company.timezone)
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId: principal.workspaceId,
        primaryCompanyId: company.id,
        accountType: 'USER',
        isActive: true,
        birthDate: { not: null },
      },
      select: {
        id: true,
        displayName: true,
        avatarAsset: true,
        jobTitle: true,
        birthDate: true,
      },
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
    })
    return users
      .flatMap((user) => user.birthDate
        ? [{
            id: user.id,
            displayName: user.displayName,
            avatarAsset: user.avatarAsset,
            jobTitle: user.jobTitle,
            birthdayDate: {
              month: user.birthDate.getUTCMonth() + 1,
              day: user.birthDate.getUTCDate(),
            },
            daysUntilBirthday: daysUntilBirthday(user.birthDate, today),
          }]
        : [])
      .sort((left, right) => left.daysUntilBirthday - right.daysUntilBirthday
        || left.displayName.localeCompare(right.displayName, 'uk')
        || left.id.localeCompare(right.id))
      .slice(0, 3)
      .map(({ daysUntilBirthday, ...birthday }) => ({
        ...birthday,
        isToday: daysUntilBirthday === 0,
      }))
  }

  private isDefaultFeedPage(query: FeedListQuery): boolean {
    return !query.cursor
      && query.filter === 'ALL'
      && query.type === 'ALL'
      && !query.authorId
      && !query.groupId
      && !query.audienceId
      && !query.dateFrom
      && !query.dateTo
      && !query.mentioned
      && !query.important
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
      eventKey: `feed:post:${input.postId}:${input.companyId}:v${input.sourceVersion}:${input.action.toLowerCase()}`,
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
