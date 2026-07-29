import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client.js'
import { id } from '../../common/crypto.js'
import { PrismaService } from '../../prisma/prisma.service.js'

type ProjectionTransaction = Prisma.TransactionClient

interface TaskProjectionSource {
  id: string
  workspaceId: string
  companyId: string
  createdById: string
  reporterId: string
  version: number
  createdAt: Date
  updatedAt: Date
}

interface EventProjectionSource {
  id: string
  workspaceId: string
  companyId: string
  ownerId: string
  visibility: string
  version: number
  createdAt: Date
  updatedAt: Date
}

interface AnnouncementProjectionSource {
  id: string
  workspaceId: string
  authorId: string
  version: number
  publishAt: Date | null
  createdAt: Date
}

interface ProjectionOptions {
  action: string
  occurredAt?: Date
  historical?: boolean
  actorId?: string
  recipientIds?: string[]
}

export interface FeedProjectionWriteInput {
  workspaceId: string
  companyId: string
  sourceType: 'TASK' | 'EVENT' | 'ANNOUNCEMENT' | 'FILE'
  sourceId: string
  fileShareId?: string
  sourceVersion: number
  action: string
  actorId: string | null
  recipientIds: string[]
  visibility: 'COMPANY' | 'PARTICIPANTS'
  occurredAt: Date
  historical?: boolean
}

export interface HistoricalFeedMaterializationInput {
  companyId: string
  cutoverAt: Date
  taskIds?: string[]
  eventIds?: string[]
  announcementIds?: string[]
}

interface FeedSourceHeadInput {
  workspaceId: string
  companyId: string
  sourceType: string
  sourceId: string
  itemId: string
  sourceVersion: number
  countsAsUnread: boolean
  occurredAt: Date
}

/**
 * Materializes immutable FeedItem projections from canonical aggregates.
 * The projection deliberately stores no editable source body: Feed reads the
 * authorized Task/Event/Announcement/File share again before returning a card.
 */
@Injectable()
export class FeedProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  projectTask(
    tx: ProjectionTransaction,
    task: TaskProjectionSource,
    options: ProjectionOptions,
  ) {
    const {
      actorId,
      recipientIds = [],
      occurredAt = task.updatedAt,
      ...projectionOptions
    } = options
    return this.createProjection(tx, {
      workspaceId: task.workspaceId,
      companyId: task.companyId,
      sourceType: 'TASK',
      sourceId: task.id,
      sourceVersion: task.version,
      actorId: actorId ?? task.createdById,
      recipientIds: [...new Set([task.createdById, task.reporterId, ...recipientIds])],
      visibility: 'PARTICIPANTS',
      occurredAt,
      ...projectionOptions,
    })
  }

  projectEvent(
    tx: ProjectionTransaction,
    event: EventProjectionSource,
    options: ProjectionOptions,
  ) {
    return this.createProjection(tx, {
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      sourceType: 'EVENT',
      sourceId: event.id,
      sourceVersion: event.version,
      actorId: event.ownerId,
      recipientIds: [event.ownerId],
      visibility: ['INTERNAL', 'PUBLIC_SAFE'].includes(event.visibility) ? 'COMPANY' : 'PARTICIPANTS',
      occurredAt: options.occurredAt ?? event.updatedAt,
      ...options,
    })
  }

  projectAnnouncement(
    tx: ProjectionTransaction,
    announcement: AnnouncementProjectionSource,
    companyId: string,
    recipientIds: string[],
    options: ProjectionOptions,
  ) {
    return this.createProjection(tx, {
      workspaceId: announcement.workspaceId,
      companyId,
      sourceType: 'ANNOUNCEMENT',
      sourceId: announcement.id,
      sourceVersion: announcement.version,
      actorId: announcement.authorId,
      recipientIds,
      visibility: 'PARTICIPANTS',
      occurredAt: options.occurredAt ?? announcement.publishAt ?? announcement.createdAt,
      ...options,
    })
  }

  /**
   * Importer hook: callers must pass the exact dependency-closed source IDs
   * selected by the approved history policy. It is intentionally not a public
   * "import everything" endpoint while D-020 is unresolved.
   */
  async materializeHistoricalSources(input: HistoricalFeedMaterializationInput) {
    if (Number.isNaN(input.cutoverAt.getTime())) throw new Error('HistoricalFeedCutoverInvalid')
    const expectedTaskIds = new Set(input.taskIds ?? [])
    const expectedEventIds = new Set(input.eventIds ?? [])
    const expectedAnnouncementIds = new Set(input.announcementIds ?? [])
    const [tasks, events, announcements] = await Promise.all([
      expectedTaskIds.size > 0
        ? this.prisma.task.findMany({
            where: { id: { in: [...expectedTaskIds] }, companyId: input.companyId },
          })
        : Promise.resolve([]),
      expectedEventIds.size > 0
        ? this.prisma.event.findMany({
            where: { id: { in: [...expectedEventIds] }, companyId: input.companyId },
          })
        : Promise.resolve([]),
      expectedAnnouncementIds.size > 0
        ? this.prisma.announcement.findMany({
            where: {
              id: { in: [...expectedAnnouncementIds] },
              companies: { some: { companyId: input.companyId } },
            },
            include: {
              receipts: { select: { userId: true } },
            },
          })
        : Promise.resolve([]),
    ])
    if (tasks.length !== expectedTaskIds.size) throw new Error('HistoricalTaskProjectionSourceMissing')
    if (events.length !== expectedEventIds.size) throw new Error('HistoricalEventProjectionSourceMissing')
    if (announcements.length !== expectedAnnouncementIds.size) {
      throw new Error('HistoricalAnnouncementProjectionSourceMissing')
    }

    let createdTasks = 0
    let createdEvents = 0
    let createdAnnouncements = 0
    for (const task of tasks) {
      const occurredAt = this.atOrBeforeCutover(task.updatedAt, input.cutoverAt)
      const created = await this.prisma.$transaction((tx) => this.projectTask(tx, task, {
        action: 'IMPORTED',
        occurredAt,
        historical: true,
      }))
      if (created) createdTasks += 1
    }
    for (const event of events) {
      const occurredAt = this.atOrBeforeCutover(event.updatedAt, input.cutoverAt)
      const created = await this.prisma.$transaction((tx) => this.projectEvent(tx, event, {
        action: 'IMPORTED',
        occurredAt,
        historical: true,
      }))
      if (created) createdEvents += 1
    }
    for (const announcement of announcements) {
      const occurredAt = this.atOrBeforeCutover(
        announcement.publishAt ?? announcement.createdAt,
        input.cutoverAt,
      )
      const created = await this.prisma.$transaction((tx) => this.projectAnnouncement(
        tx,
        announcement,
        input.companyId,
        announcement.receipts.map((receipt) => receipt.userId),
        { action: 'IMPORTED', occurredAt, historical: true },
      ))
      if (created) createdAnnouncements += 1
    }

    const seededCursors = await this.seedHistoricalReadCursors(input.companyId, input.cutoverAt)
    return {
      created: {
        tasks: createdTasks,
        events: createdEvents,
        announcements: createdAnnouncements,
      },
      seededCursors,
    }
  }

  async seedHistoricalReadCursors(companyId: string, cutoverAt: Date): Promise<number> {
    const users = await this.prisma.userCompanyAccess.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: { userId: true },
    })
    let seeded = 0
    for (const { userId } of users) {
      const memberships = await this.prisma.groupMember.findMany({
        where: { userId, leftAt: null, group: { companyId, status: 'ACTIVE' } },
        select: { groupId: true },
      })
      const groupIds = memberships.map((membership) => membership.groupId)
      const latest = await this.prisma.feedItem.findFirst({
        where: {
          companyId,
          countsAsUnread: false,
          occurredAt: { lte: cutoverAt },
          OR: [
            { recipients: { some: { userId } } },
            { visibility: 'COMPANY', postId: null },
            { post: { is: { authorId: userId } } },
            {
              post: {
                is: {
                  recipients: {
                    some: {
                      OR: [
                        { type: 'COMPANY', recipientId: companyId },
                        { type: 'USER', recipientId: userId },
                        ...(groupIds.length > 0
                          ? [{ type: 'GROUP' as const, recipientId: { in: groupIds } }]
                          : []),
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { id: true, occurredAt: true },
      })
      if (!latest) continue
      const current = await this.prisma.feedReadCursor.findUnique({
        where: { userId_companyId: { userId, companyId } },
      })
      if (current && this.comparePosition(
        current.lastReadOccurredAt,
        current.lastReadItemId,
        latest.occurredAt,
        latest.id,
      ) >= 0) continue
      await this.prisma.feedReadCursor.upsert({
        where: { userId_companyId: { userId, companyId } },
        create: {
          id: id('fcur'),
          userId,
          companyId,
          lastReadOccurredAt: latest.occurredAt,
          lastReadItemId: latest.id,
        },
        update: {
          lastReadOccurredAt: latest.occurredAt,
          lastReadItemId: latest.id,
        },
      })
      seeded += 1
    }
    return seeded
  }

  private async createProjection(
    tx: ProjectionTransaction,
    input: FeedProjectionWriteInput,
  ): Promise<string | null> {
    return writeFeedProjection(tx, input)
  }

  private atOrBeforeCutover(value: Date, cutoverAt: Date): Date {
    return value > cutoverAt ? cutoverAt : value
  }

  private comparePosition(
    leftAt: Date,
    leftId: string,
    rightAt: Date,
    rightId: string,
  ): number {
    const time = leftAt.getTime() - rightAt.getTime()
    return time === 0 ? leftId.localeCompare(rightId) : time
  }
}

export async function writeFeedProjection(
  tx: ProjectionTransaction,
  input: FeedProjectionWriteInput,
): Promise<string | null> {
  const normalizedAction = input.action.toLowerCase()
  const companySegment = input.sourceType === 'ANNOUNCEMENT' ? `:${input.companyId}` : ''
  const eventKey = `feed:${input.sourceType.toLowerCase()}:${input.sourceId}${companySegment}:v${input.sourceVersion}:${normalizedAction}`
  const existing = await tx.feedItem.findUnique({ where: { eventKey }, select: { id: true } })
  if (existing) return null
  const itemId = id('fitem')
  await tx.feedItem.create({
    data: {
      id: itemId,
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.fileShareId ? { fileShareId: input.fileShareId } : {}),
      sourceVersion: input.sourceVersion,
      action: input.action,
      eventKey,
      actorId: input.actorId,
      visibility: input.visibility,
      safePayload: JSON.stringify({
        schemaVersion: 1,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        action: input.action,
        historical: Boolean(input.historical),
      }),
      countsAsUnread: !input.historical,
      occurredAt: input.occurredAt,
    },
  })
  await advanceFeedSourceHead(tx, {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    itemId,
    sourceVersion: input.sourceVersion,
    countsAsUnread: !input.historical,
    occurredAt: input.occurredAt,
  })
  await moveFeedFavorites(tx, {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    newItemId: itemId,
  })
  const requestedRecipients = [...new Set(input.recipientIds)]
  const activeRecipients = requestedRecipients.length > 0
    ? await tx.userCompanyAccess.findMany({
        where: {
          userId: { in: requestedRecipients },
          companyId: input.companyId,
          status: 'ACTIVE',
        },
        select: { userId: true },
      })
    : []
  if (activeRecipients.length > 0) {
    await tx.feedItemRecipient.createMany({
      data: activeRecipients.map(({ userId }) => ({
        id: id('firec'),
        itemId,
        userId,
      })),
    })
  }
  return itemId
}

export async function advanceFeedSourceHead(
  tx: ProjectionTransaction,
  input: FeedSourceHeadInput,
): Promise<boolean> {
  const key = {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  }
  const current = await tx.feedSourceHead.findUnique({
    where: { workspaceId_companyId_sourceType_sourceId: key },
    select: { itemId: true, sourceVersion: true, occurredAt: true },
  })
  const advances = !current
    || input.sourceVersion > current.sourceVersion
    || (
      input.sourceVersion === current.sourceVersion
      && (
        input.occurredAt > current.occurredAt
        || (
          input.occurredAt.getTime() === current.occurredAt.getTime()
          && input.itemId > current.itemId
        )
      )
    )
  if (!advances) return false
  await tx.feedSourceHead.upsert({
    where: { workspaceId_companyId_sourceType_sourceId: key },
    create: {
      id: id('fhead'),
      ...key,
      itemId: input.itemId,
      sourceVersion: input.sourceVersion,
      countsAsUnread: input.countsAsUnread,
      occurredAt: input.occurredAt,
    },
    update: {
      itemId: input.itemId,
      sourceVersion: input.sourceVersion,
      countsAsUnread: input.countsAsUnread,
      occurredAt: input.occurredAt,
    },
  })
  return true
}

export async function moveFeedFavorites(
  tx: ProjectionTransaction,
  input: {
    workspaceId: string
    companyId: string
    sourceType: string
    sourceId: string
    newItemId: string
  },
): Promise<void> {
  const previous = await tx.feedUserItemState.findMany({
    where: {
      favoritedAt: { not: null },
      feedItemId: { not: input.newItemId },
      feedItem: {
        workspaceId: input.workspaceId,
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  })
  if (previous.length === 0) return
  const latestByUser = new Map<string, Date>()
  for (const state of previous) {
    if (state.favoritedAt && !latestByUser.has(state.userId)) {
      latestByUser.set(state.userId, state.favoritedAt)
    }
  }
  const activeUsers = await tx.userCompanyAccess.findMany({
    where: {
      userId: { in: [...latestByUser.keys()] },
      companyId: input.companyId,
      status: 'ACTIVE',
      user: { workspaceId: input.workspaceId, status: 'ACTIVE' },
    },
    select: { userId: true },
  })
  await tx.feedUserItemState.deleteMany({
    where: {
      feedItemId: { not: input.newItemId },
      feedItem: {
        workspaceId: input.workspaceId,
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
  })
  if (activeUsers.length === 0) return
  await tx.feedUserItemState.createMany({
    data: activeUsers.map(({ userId }) => ({
      id: id('fstate'),
      userId,
      feedItemId: input.newItemId,
      favoritedAt: latestByUser.get(userId) ?? new Date(),
    })),
  })
}
