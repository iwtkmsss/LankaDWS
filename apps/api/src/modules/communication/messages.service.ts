import { Injectable } from '@nestjs/common'
import {
  type AddChatParticipantInput,
  type ChatAttachmentView,
  type ChatContactUser,
  type ChatMentionCandidatesQuery,
  type ChatMessagePage,
  type ChatMessagePageQuery,
  type ChatMessageSearchPage,
  type ChatMessageSearchQuery,
  type ChatMessageView,
  type ChatNotificationMode,
  type ChatParticipantView,
  type ChatThreadDetail,
  type ChatThreadKind,
  type ChatThreadListItem,
  type ChatThreadListQuery,
  type ChatThreadPage,
  type ChatThreadPreview,
  type ChatUserSearchPage,
  type ChatUserSearchQuery,
  type CreateChatThreadInput,
  type ConvertChatMessageToTaskInput,
  type DeleteChatMessageInput,
  type EditChatMessageInput,
  type MarkChatReadInput,
  type MentionCandidateView,
  type RecommendedChatUsersPage,
  type RecommendedChatUsersQuery,
  type RemoveChatParticipantInput,
  type SendChatMessageInput,
  type StructuredMentionInput,
  type StructuredMentionView,
  type UpdateChatParticipantInput,
  type UpdateChatPreferenceInput,
} from '@bert-crm/contracts'
import { fingerprint, id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { isUserSearchValueLongEnough, normalizeUserSearchValue } from '../../common/user-search.js'
import type { FileObject, Message, MessageThread, Prisma, ThreadParticipant, User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { TaskCommandService } from '../tasks/task-command.service.js'
import { scoreChatRecommendation, type ChatRecommendationSignals } from './chat-recommendations.js'
import { ChatRealtimeService } from './chat-realtime.service.js'
import {
  decodeChatMessageCursor,
  decodeChatThreadCursor,
  encodeChatMessageCursor,
  encodeChatThreadCursor,
  type ChatMessageCursor,
  type ChatThreadCursor,
} from './chat-cursors.js'

type SafeUser = Pick<User, 'id' | 'displayName' | 'username' | 'jobTitle' | 'avatarAsset'>
type ThreadWithParticipants = MessageThread & {
  participants: ThreadParticipant[]
}
type ThreadListRow = ThreadWithParticipants & { messages: Message[] }

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly files: FilesService,
    private readonly taskCommands: TaskCommandService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  async threads(
    principal: AuthPrincipal,
    query: ChatThreadListQuery,
  ): Promise<ChatThreadPage> {
    const companyIds = this.scope.allowedCompanies(principal, query.company)
    const cursor = query.cursor ? this.decodeThreadCursor(query.cursor) : null
    const visibleGroupIds = await this.visibleChatGroupIds(principal, companyIds)
    const unreadPageIds = query.unread
      ? await this.unreadThreadPageIds(
          principal,
          companyIds,
          visibleGroupIds,
          cursor,
          query.limit + 1,
        )
      : null
    const selectedIds = unreadPageIds?.slice(0, query.limit)
    const rows = selectedIds?.length === 0 ? [] : await this.prisma.messageThread.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        participants: {
          some: {
            userId: principal.userId,
            leftAt: null,
          },
        },
        ...this.visibleThreadWhere(visibleGroupIds),
        ...(cursor ? this.threadCursorWhere(cursor) : {}),
        ...(selectedIds ? { id: { in: selectedIds } } : {}),
      },
      include: {
        participants: true,
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...(selectedIds ? {} : { take: query.limit + 1 }),
    })
    const authorizedRows = rows.slice(0, query.limit)
    const usersById = await this.safeUsers(
      authorizedRows.flatMap((thread) => thread.participants.map((participant) => participant.userId)),
    )
    const unreadByThread = await this.unreadCounts(
      principal.userId,
      authorizedRows.map((thread) => thread.id),
    )
    const allItems = authorizedRows.map((thread) =>
      this.threadListItem(principal, thread, usersById, unreadByThread.get(thread.id) ?? 0),
    )
    const counts = await this.threadSummary(principal, companyIds, visibleGroupIds)
    const sourceLast = allItems.at(-1)
    const sourceThread = sourceLast
      ? authorizedRows.find((thread) => thread.id === sourceLast.id)
      : null
    return {
      items: allItems,
      counts,
      nextCursor: sourceThread && (
        unreadPageIds ? unreadPageIds.length > query.limit : rows.length > query.limit
      )
        ? this.encodeThreadCursor(sourceThread)
        : null,
    }
  }

  async summary(
    principal: AuthPrincipal,
    company?: string,
  ): Promise<{ all: number; unread: number }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const visibleGroupIds = await this.visibleChatGroupIds(principal, companyIds)
    return this.threadSummary(principal, companyIds, visibleGroupIds)
  }

  async create(
    principal: AuthPrincipal,
    input: CreateChatThreadInput,
    idempotencyKey: string,
  ): Promise<{ id: string; created: boolean }> {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    const participantIds = input.participantIds
      .filter((userId) => userId !== principal.userId)
      .sort()
    if (
      (input.kind === 'DIRECT' && participantIds.length !== 1)
      || (input.kind === 'GROUP' && participantIds.length < 2)
    ) throw badRequest('chat_participants_invalid')
    const groupTitle = input.title?.trim() ?? ''
    const title = input.kind === 'GROUP' ? groupTitle : null
    if (input.kind === 'GROUP' && (groupTitle.length < 2 || groupTitle.length > 120)) {
      throw badRequest('chat_title_invalid')
    }
    await this.assertActiveCompanyUsers(companyId, participantIds)
    const requestFingerprint = this.chatFingerprint('chat.thread.create', {
      companyId,
      kind: input.kind,
      title,
      participantIds,
    })
    const existingRequest = await this.idempotentResult(
      principal.userId,
      idempotencyKey,
      'chat.thread.create',
      requestFingerprint,
    )
    if (existingRequest) return { id: existingRequest, created: false }

    const directKey = input.kind === 'DIRECT'
      ? this.chatFingerprint('chat.direct', {
          workspaceId: principal.workspaceId,
          companyId,
          userIds: [principal.userId, ...participantIds].sort(),
        })
      : null
    if (directKey) {
      const existingDirect = await this.findDirectThread(
        principal.workspaceId,
        companyId,
        [principal.userId, ...participantIds].sort(),
        directKey,
      )
      if (existingDirect) {
        await this.prisma.$transaction(async (tx) => {
          if (!existingDirect.directKey) {
            await tx.messageThread.update({
              where: { id: existingDirect.id },
              data: { directKey },
            })
          }
          await tx.idempotencyRecord.upsert({
            where: {
              userId_key_operation: {
                userId: principal.userId,
                key: idempotencyKey,
                operation: 'chat.thread.create',
              },
            },
            create: {
              id: id('idem'),
              userId: principal.userId,
              key: idempotencyKey,
              operation: 'chat.thread.create',
              requestFingerprint,
              resultType: 'MESSAGE_THREAD',
              resultId: existingDirect.id,
              responseStatus: 200,
              expiresAt: new Date(Date.now() + 86_400_000),
            },
            update: {},
          })
        })
        return { id: existingDirect.id, created: false }
      }
    }

    const threadId = id('thr')
    try {
      await this.prisma.$transaction(async (tx) => {
        const thread = await tx.messageThread.create({
        data: {
          id: threadId,
          workspaceId: principal.workspaceId,
          companyId,
          kind: input.kind,
          title,
          directKey,
          createdById: principal.userId,
        },
      })
        await tx.threadParticipant.createMany({
        data: [
          {
            id: id('tpart'),
            threadId,
            userId: principal.userId,
            role: input.kind === 'DIRECT' ? 'MEMBER' : 'OWNER',
          },
          ...participantIds.map((userId) => ({
            id: id('tpart'),
            threadId,
            userId,
            role: 'MEMBER',
          })),
        ],
      })
        await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'chat.thread.create',
          requestFingerprint,
          resultType: 'MESSAGE_THREAD',
          resultId: threadId,
          responseStatus: 201,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
        await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.thread_created',
          entityType: 'MESSAGE_THREAD',
          entityId: threadId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({
            kind: input.kind,
            participantCount: participantIds.length + 1,
          }),
          correlationId: id('corr'),
        },
      })
        await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: threadId,
          aggregateVersion: thread.version,
          eventType: 'message.thread_created',
          safePayload: JSON.stringify({ threadId, companyId, kind: input.kind }),
        },
        })
      })
    } catch (error) {
      if (!directKey) throw error
      const canonical = await this.findDirectThread(
        principal.workspaceId,
        companyId,
        [principal.userId, ...participantIds].sort(),
        directKey,
      )
      if (!canonical) throw error
      await this.prisma.idempotencyRecord.upsert({
        where: {
          userId_key_operation: {
            userId: principal.userId,
            key: idempotencyKey,
            operation: 'chat.thread.create',
          },
        },
        create: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'chat.thread.create',
          requestFingerprint,
          resultType: 'MESSAGE_THREAD',
          resultId: canonical.id,
          responseStatus: 200,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        update: {},
      })
      return { id: canonical.id, created: false }
    }
    return { id: threadId, created: true }
  }

  async groupThread(
    principal: AuthPrincipal,
    groupId: string,
  ): Promise<{ id: string; created: boolean }> {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
        status: 'ACTIVE',
        members: { some: { userId: principal.userId, leftAt: null } },
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        ownerId: true,
        members: {
          where: {
            leftAt: null,
            user: {
              isActive: true,
              primaryCompanyId: { not: null },
            },
          },
          select: { userId: true },
        },
      },
    })
    if (!group) throw notFound()
    const existing = await this.prisma.messageThread.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        companyId: group.companyId,
        kind: 'CONTEXTUAL',
        entityType: 'GROUP',
        entityId: group.id,
      },
      select: {
        id: true,
        participants: {
          where: { userId: principal.userId },
          select: { id: true, leftAt: true },
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (existing) {
      const participant = existing.participants[0]
      if (!participant || participant.leftAt) {
        await this.prisma.threadParticipant.upsert({
          where: { threadId_userId: { threadId: existing.id, userId: principal.userId } },
          create: {
            id: id('tpart'),
            threadId: existing.id,
            userId: principal.userId,
            role: principal.userId === group.ownerId ? 'OWNER' : 'MEMBER',
          },
          update: {
            leftAt: null,
            role: principal.userId === group.ownerId ? 'OWNER' : 'MEMBER',
            version: { increment: 1 },
          },
        })
      }
      return { id: existing.id, created: false }
    }

    const participantIds = [...new Set(group.members.map((member) => member.userId))]
    if (!participantIds.includes(principal.userId)) throw notFound()
    await this.assertActiveCompanyUsers(group.companyId, participantIds)
    const threadId = id('thr')
    await this.prisma.$transaction(async (tx) => {
      const thread = await tx.messageThread.create({
        data: {
          id: threadId,
          workspaceId: principal.workspaceId,
          companyId: group.companyId,
          kind: 'CONTEXTUAL',
          title: group.name,
          entityType: 'GROUP',
          entityId: group.id,
          createdById: principal.userId,
        },
      })
      await tx.threadParticipant.createMany({
        data: participantIds.map((userId) => ({
          id: id('tpart'),
          threadId,
          userId,
          role: userId === group.ownerId ? 'OWNER' : 'MEMBER',
        })),
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: group.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.group_thread_opened',
          entityType: 'MESSAGE_THREAD',
          entityId: threadId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ groupId: group.id, participantCount: participantIds.length }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: threadId,
          aggregateVersion: thread.version,
          eventType: 'message.group_thread_created',
          safePayload: JSON.stringify({ threadId, groupId: group.id, companyId: group.companyId }),
        },
      })
    })
    return { id: threadId, created: true }
  }

  async detail(principal: AuthPrincipal, threadId: string): Promise<ChatThreadDetail> {
    const thread = await this.readableThread(principal, threadId)
    const usersById = await this.safeUsers(
      thread.participants.map((participant) => participant.userId),
    )
    const currentParticipant = thread.participants.find(
      (participant) => participant.userId === principal.userId && !participant.leftAt,
    )
    if (!currentParticipant) throw notFound()
    const lastMessage = await this.prisma.message.findFirst({
      where: { threadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
    const kind = this.threadKind(thread.kind)
    const isGroupContext = kind === 'CONTEXTUAL'
      && thread.entityType === 'GROUP'
      && Boolean(thread.entityId)
    const canManageParticipants = (
      kind === 'GROUP'
      || kind === 'CONTEXTUAL'
    ) && !isGroupContext && (
      currentParticipant.role === 'OWNER'
      || isGlobalAdmin(principal)
    )
    const activeOwnerCount = thread.participants.filter(
      (participant) => participant.role === 'OWNER' && !participant.leftAt,
    ).length
    return {
      id: thread.id,
      companyId: thread.companyId!,
      title: this.threadTitle(principal.userId, thread, usersById),
      kind,
      version: thread.version,
      notificationMode: this.notificationMode(currentParticipant.notificationMode),
      participantVersion: currentParticipant.version,
      participants: thread.participants
        .filter((participant) => !participant.leftAt)
        .map((participant) => this.participantView(participant, usersById))
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'uk')),
      lastMessageId: lastMessage?.id ?? null,
      lastReadMessageId: currentParticipant.lastReadMessageId,
      canPost: true,
      canManageParticipants,
      canLeave: (
        kind === 'GROUP'
        || kind === 'CONTEXTUAL'
      ) && !isGroupContext && (
        currentParticipant.role !== 'OWNER'
        || activeOwnerCount > 1
      ),
    }
  }

  async messagesPage(
    principal: AuthPrincipal,
    threadId: string,
    query: ChatMessagePageQuery,
  ): Promise<ChatMessagePage> {
    const thread = await this.readableThread(principal, threadId)
    const limit = query.limit
    if (query.around) {
      const target = await this.prisma.message.findFirst({
        where: { id: query.around, threadId },
      })
      if (!target) throw notFound()
      const beforeLimit = Math.floor((limit - 1) / 2)
      const afterLimit = limit - 1 - beforeLimit
      const [beforeRows, afterRows] = await Promise.all([
        this.prisma.message.findMany({
          where: { threadId, ...this.messageBeforeWhere(target) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: beforeLimit + 1,
        }),
        this.prisma.message.findMany({
          where: { threadId, ...this.messageAfterWhere(target) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: afterLimit + 1,
        }),
      ])
      const selectedBefore = beforeRows.slice(0, beforeLimit).reverse()
      const selectedAfter = afterRows.slice(0, afterLimit)
      const selected = [...selectedBefore, target, ...selectedAfter]
      return {
        items: await this.messageViews(principal, thread, selected),
        olderCursor: beforeRows.length > beforeLimit
          ? this.encodeMessageCursor(selected[0])
          : null,
        newerCursor: afterRows.length > afterLimit
          ? this.encodeMessageCursor(selected.at(-1)!)
          : null,
      }
    }

    const cursor = query.before
      ? this.decodeMessageCursor(query.before)
      : query.after
        ? this.decodeMessageCursor(query.after)
        : null
    const direction = query.after ? 'after' : 'before'
    const rows = await this.prisma.message.findMany({
      where: {
        threadId,
        ...(cursor
          ? direction === 'after'
            ? this.messageAfterWhere(cursor)
            : this.messageBeforeWhere(cursor)
          : {}),
      },
      orderBy: direction === 'after'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const selected = rows.slice(0, limit)
    if (direction === 'before') selected.reverse()
    return {
      items: await this.messageViews(principal, thread, selected),
      olderCursor: (
        (direction === 'before' && hasMore)
        || direction === 'after'
      ) && selected[0]
        ? this.encodeMessageCursor(selected[0])
        : null,
      newerCursor: (
        (direction === 'after' && hasMore)
        || Boolean(query.before)
      ) && selected.at(-1)
        ? this.encodeMessageCursor(selected.at(-1)!)
        : null,
    }
  }

  async searchMessages(
    principal: AuthPrincipal,
    threadId: string,
    query: ChatMessageSearchQuery,
  ): Promise<ChatMessageSearchPage> {
    const thread = await this.readableThread(principal, threadId)
    const cursor = query.cursor ? this.decodeMessageCursor(query.cursor) : null
    const where: Prisma.MessageWhereInput = {
      threadId,
      deletedAt: null,
      body: { contains: query.q },
      ...(cursor ? this.messageBeforeWhere(cursor) : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.message.count({
        where: { threadId, deletedAt: null, body: { contains: query.q } },
      }),
    ])
    const selected = rows.slice(0, query.limit)
    return {
      items: await this.messageViews(principal, thread, selected),
      total,
      nextCursor: rows.length > query.limit && selected.at(-1)
        ? this.encodeMessageCursor(selected.at(-1)!)
        : null,
    }
  }

  async message(principal: AuthPrincipal, messageId: string): Promise<ChatMessageView> {
    const message = await this.readableMessage(principal, messageId)
    const thread = await this.readableThread(principal, message.threadId)
    const [view] = await this.messageViews(principal, thread, [message])
    if (!view) throw notFound()
    return view
  }

  async preview(principal: AuthPrincipal, threadId: string): Promise<ChatThreadPreview> {
    const thread = await this.readableThread(principal, threadId)
    const latest = await this.prisma.message.findMany({
      where: { threadId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
    })
    const usersById = await this.safeUsers(
      thread.participants.map((participant) => participant.userId),
    )
    const unread = await this.unreadCounts(principal.userId, [threadId])
    return {
      item: this.threadListItem(
        principal,
        { ...thread, messages: latest },
        usersById,
        unread.get(threadId) ?? 0,
      ),
      counts: await this.summary(principal, thread.companyId ?? undefined),
    }
  }

  async searchUsers(
    principal: AuthPrincipal,
    query: ChatUserSearchQuery,
  ): Promise<ChatUserSearchPage> {
    const companyId = this.scope.assertCompany(principal, query.company)
    const normalized = normalizeUserSearchValue(query.q)
    if (!isUserSearchValueLongEnough(normalized)) throw badRequest('chat_user_search_too_short')
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId: principal.workspaceId,
        id: { not: principal.userId },
        isActive: true,
        AND: [
          { OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }] },
          { OR: [
            { normalizedUsername: { contains: normalized } },
            { normalizedDisplayName: { contains: normalized } },
          ] },
        ],
      },
      select: {
        id: true,
        displayName: true,
        normalizedDisplayName: true,
        username: true,
        normalizedUsername: true,
        jobTitle: true,
        avatarAsset: true,
      },
      take: 120,
    })
    const collator = new Intl.Collator('uk-UA')
    users.sort((left, right) => {
      const rank = this.userSearchRank(left, normalized) - this.userSearchRank(right, normalized)
      return rank
        || collator.compare(left.normalizedDisplayName, right.normalizedDisplayName)
        || left.id.localeCompare(right.id)
    })
    return { items: users.slice(0, query.limit).map((user) => this.contactUser(user)) }
  }

  async mentionCandidates(
    principal: AuthPrincipal,
    threadId: string,
    query: ChatMentionCandidatesQuery,
  ): Promise<{ items: MentionCandidateView[] }> {
    const thread = await this.readableThread(principal, threadId)
    this.assertMentionableThread(thread)
    const companyId = thread.companyId
    if (!companyId) throw notFound()
    const participantIds = thread.participants
      .filter((participant) => !participant.leftAt)
      .map((participant) => participant.userId)
    const normalized = normalizeUserSearchValue(query.q)
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: participantIds },
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
      take: query.limit,
    })
    return { items: users }
  }

  async recommendedUsers(
    principal: AuthPrincipal,
    query: RecommendedChatUsersQuery,
  ): Promise<RecommendedChatUsersPage> {
    const companyId = this.scope.assertCompany(principal, query.company)
    const since = new Date(Date.now() - 90 * 86_400_000)
    const [directThreads, ownGroups, relatedTasks, ownAssignments] = await Promise.all([
      this.prisma.messageThread.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId,
          kind: 'DIRECT',
          participants: { some: { userId: principal.userId, leftAt: null } },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: 80,
        select: {
          participants: { where: { leftAt: null }, select: { userId: true } },
          messages: {
            where: { deletedAt: null, createdAt: { gte: since } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 40,
            select: { authorId: true, createdAt: true },
          },
        },
      }),
      this.prisma.groupMember.findMany({
        where: {
          userId: principal.userId,
          leftAt: null,
          group: { companyId, status: 'ACTIVE' },
        },
        select: { groupId: true },
        take: 100,
      }),
      this.prisma.task.findMany({
        where: {
          companyId,
          archivedAt: null,
          status: { notIn: ['DONE', 'CANCELLED', 'ARCHIVED'] },
          OR: [
            { createdById: principal.userId },
            { reporterId: principal.userId },
            { participants: { some: { userId: principal.userId, removedAt: null } } },
          ],
        },
        select: {
          createdById: true,
          reporterId: true,
          participants: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
        take: 100,
      }),
      this.prisma.userOrgAssignment.findMany({
        where: { companyId, userId: principal.userId, endedAt: null },
        select: { orgUnitId: true },
        take: 100,
      }),
    ])
    const groupIds = ownGroups.map((membership) => membership.groupId)
    const orgUnitIds = ownAssignments.map((assignment) => assignment.orgUnitId)
    const [groupPeers, orgPeers] = await Promise.all([
      groupIds.length
        ? this.prisma.groupMember.findMany({
            where: { groupId: { in: groupIds }, userId: { not: principal.userId }, leftAt: null },
            select: { userId: true },
            take: 100,
          })
        : [],
      orgUnitIds.length
        ? this.prisma.userOrgAssignment.findMany({
            where: {
              companyId,
              orgUnitId: { in: orgUnitIds },
              userId: { not: principal.userId },
              endedAt: null,
            },
            select: { userId: true },
            take: 100,
          })
        : [],
    ])
    const signals = new Map<string, ChatRecommendationSignals>()
    const ensure = (userId: string) => {
      const existing = signals.get(userId)
      if (existing) return existing
      const created: ChatRecommendationSignals = {
        lastInteractionAt: null,
        sentCount: 0,
        receivedCount: 0,
        sharedGroup: false,
        activeTaskRelationship: false,
        sharedOrgUnit: false,
      }
      if (signals.size < 200) signals.set(userId, created)
      return created
    }
    for (const thread of directThreads) {
      const contactId = thread.participants.find(
        (participant) => participant.userId !== principal.userId,
      )?.userId
      if (!contactId) continue
      const signal = ensure(contactId)
      for (const message of thread.messages) {
        signal.lastInteractionAt ??= message.createdAt
        if (message.authorId === principal.userId) signal.sentCount += 1
        else signal.receivedCount += 1
      }
    }
    for (const peer of groupPeers) ensure(peer.userId).sharedGroup = true
    for (const peer of orgPeers) ensure(peer.userId).sharedOrgUnit = true
    for (const task of relatedTasks) {
      for (const userId of [
        task.createdById,
        task.reporterId,
        ...task.participants.map((participant) => participant.userId),
      ]) {
        if (userId !== principal.userId) ensure(userId).activeTaskRelationship = true
      }
    }

    const candidateIds = [...signals.keys()]
    const users = candidateIds.length
      ? await this.recommendationUsers(principal, companyId, candidateIds)
      : []
    if (users.length < query.limit) {
      const fallback = await this.recommendationUsers(principal, companyId)
      for (const user of fallback) {
        if (users.some((existing) => existing.id === user.id)) continue
        ensure(user.id).fallbackTeam = true
        users.push(user)
        if (users.length >= 200) break
      }
    }
    const collator = new Intl.Collator('uk-UA')
    return {
      items: users
        .map((user) => ({
          user,
          ...scoreChatRecommendation(signals.get(user.id) ?? {
            lastInteractionAt: null,
            sentCount: 0,
            receivedCount: 0,
            sharedGroup: false,
            activeTaskRelationship: false,
            sharedOrgUnit: false,
            fallbackTeam: true,
          }),
        }))
        .sort((left, right) =>
          right.score - left.score
          || collator.compare(left.user.displayName, right.user.displayName)
          || left.user.id.localeCompare(right.user.id),
        )
        .slice(0, query.limit)
        .map(({ user, reason }) => ({ ...this.contactUser(user), reason })),
    }
  }

  async post(
    principal: AuthPrincipal,
    threadId: string,
    input: SendChatMessageInput,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    const thread = await this.readableThread(principal, threadId)
    const text = input.body.trim()
    const replyToId = input.replyToId ?? null
    const attachmentIds = input.attachmentIds
    const mentionedUserIds = this.validateStructuredMentions(text, input.mentions)
    if (input.mentions.length > 0) {
      await this.assertMessageMentionRecipients(principal, thread, mentionedUserIds)
    }
    if (!text || text.length > 8_000) throw badRequest('message_body')
    if (replyToId) {
      const parent = await this.prisma.message.findFirst({
        where: { id: replyToId, threadId },
      })
      if (!parent || parent.replyToId || parent.deletedAt) throw badRequest('message_reply')
    }
    await this.files.assertAttachable(
      principal,
      thread.companyId!,
      attachmentIds,
      'chat_attachment_invalid',
    )
    const requestFingerprint = this.chatFingerprint('chat.message.create', {
      threadId,
      body: text,
      replyToId,
      attachmentIds,
      mentions: input.mentions,
    })
    const existingRequest = await this.idempotentResult(
      principal.userId,
      idempotencyKey,
      'chat.message.create',
      requestFingerprint,
    )
    if (existingRequest) return { id: existingRequest }

    const messageId = id('msg')
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          id: messageId,
          threadId,
          authorId: principal.userId,
          body: text,
          replyToId,
        },
      })
      if (attachmentIds.length > 0) {
        await tx.fileLink.createMany({
          data: attachmentIds.map((fileId) => ({
            id: id('fln'),
            fileId,
            entityType: 'MESSAGE',
            entityId: messageId,
            purpose: 'ATTACHMENT',
            aclMode: 'ENTITY',
          })),
        })
      }
      if (input.mentions.length > 0) {
        await tx.contentMention.createMany({
          data: input.mentions.map((mention) => ({
            id: id('mnt'),
            workspaceId: principal.workspaceId,
            sourceType: 'MESSAGE',
            sourceId: messageId,
            ...mention,
          })),
        })
      }
      const aggregate = await tx.messageThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: message.createdAt,
          version: { increment: 1 },
        },
        select: { version: true },
      })
      await tx.threadParticipant.update({
        where: {
          threadId_userId: {
            threadId,
            userId: principal.userId,
          },
        },
        data: {
          lastReadMessageId: messageId,
          version: { increment: 1 },
        },
      })
      const mentioned = new Set(mentionedUserIds)
      for (const participant of thread.participants) {
        if (
          participant.userId === principal.userId
          || participant.leftAt
          || participant.notificationMode !== 'ALL'
        ) continue
        await tx.notification.create({
          data: {
            id: id('ntf'),
            recipientId: participant.userId,
            category: mentioned.has(participant.userId) ? 'MENTION' : 'CHAT',
            safeTitle: mentioned.has(participant.userId) ? 'Вас згадали у повідомленні' : 'Нове повідомлення',
            safeSnippet: mentioned.has(participant.userId)
              ? 'Відкрийте діалог, щоб переглянути згадку.'
              : 'У робочому діалозі є оновлення.',
            entityType: 'MESSAGE_THREAD',
            entityId: threadId,
            requiresAction: false,
            deliveredAt: new Date(),
            dedupeKey: `chat:${messageId}:${participant.userId}`,
          },
        })
      }
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'chat.message.create',
          requestFingerprint,
          resultType: 'MESSAGE',
          resultId: messageId,
          responseStatus: 201,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: replyToId ? 'message.replied' : 'message.created',
          entityType: 'MESSAGE',
          entityId: messageId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({
            threadId,
            hasReply: Boolean(replyToId),
            attachmentCount: attachmentIds.length,
            mentionCount: mentionedUserIds.length,
          }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: threadId,
          aggregateVersion: aggregate.version,
          eventType: 'message.created',
          safePayload: JSON.stringify({ threadId, messageId, companyId: thread.companyId }),
        },
      })
    })
    void this.realtime.publish(threadId, 'message.created', messageId).catch(() => undefined)
    return { id: messageId }
  }

  async uploadAttachment(
    principal: AuthPrincipal,
    threadId: string,
    file: UploadedBinary,
  ): Promise<ChatAttachmentView> {
    const thread = await this.readableThread(principal, threadId)
    const uploaded = await this.files.upload(principal, thread.companyId!, file)
    return {
      id: uploaded.id,
      fileName: uploaded.fileName,
      bytes: uploaded.bytes,
      mimeType: uploaded.mimeType,
      scanStatus: uploaded.scanStatus,
    }
  }

  async addParticipant(
    principal: AuthPrincipal,
    threadId: string,
    input: AddChatParticipantInput,
    idempotencyKey: string,
  ): Promise<{ participant: ChatParticipantView; threadVersion: number }> {
    const thread = await this.readableThread(principal, threadId)
    const current = this.assertParticipantManager(principal, thread)
    if (input.userId === current.userId) throw badRequest('chat_participant_invalid')
    if (thread.participants.filter((participant) => !participant.leftAt).length >= 50) {
      throw badRequest('chat_participant_limit')
    }
    await this.assertActiveCompanyUsers(thread.companyId!, [input.userId])
    const operation = `chat.participant.add:${thread.id}`
    const requestFingerprint = this.chatFingerprint(operation, {
      userId: input.userId,
      role: input.role,
      expectedThreadVersion: input.expectedThreadVersion,
    })
    const existingResult = await this.idempotentResult(
      principal.userId,
      idempotencyKey,
      operation,
      requestFingerprint,
    )
    if (existingResult) {
      const [participant, aggregate, usersById] = await Promise.all([
        this.prisma.threadParticipant.findUnique({ where: { id: existingResult } }),
        this.prisma.messageThread.findUnique({
          where: { id: thread.id },
          select: { version: true },
        }),
        this.safeUsers([input.userId]),
      ])
      if (!participant || !aggregate) throw notFound()
      return {
        participant: this.participantView(participant, usersById),
        threadVersion: aggregate.version,
      }
    }
    const prior = thread.participants.find((participant) => participant.userId === input.userId)
    if (prior && !prior.leftAt) throw badRequest('chat_participant_exists')
    const now = new Date()
    const result = await this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.messageThread.updateMany({
        where: {
          id: thread.id,
          version: input.expectedThreadVersion,
        },
        data: { version: { increment: 1 } },
      })
      if (aggregate.count !== 1) {
        throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
      }
      const participant = prior
        ? await tx.threadParticipant.update({
            where: { id: prior.id },
            data: {
              role: input.role,
              leftAt: null,
              notificationMode: 'ALL',
              version: { increment: 1 },
            },
          })
        : await tx.threadParticipant.create({
            data: {
              id: id('tpart'),
              threadId: thread.id,
              userId: input.userId,
              role: input.role,
            },
          })
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'THREAD_PARTICIPANT',
          resultId: participant.id,
          responseStatus: 201,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
      await tx.notification.upsert({
        where: {
          dedupeKey: `chat-participant-added:${thread.id}:${input.userId}:v${input.expectedThreadVersion + 1}`,
        },
        create: {
          id: id('ntf'),
          recipientId: input.userId,
          category: 'CHAT',
          safeTitle: 'Вас додано до діалогу',
          safeSnippet: 'Відкрийте робочий діалог, щоб переглянути контекст.',
          entityType: 'MESSAGE_THREAD',
          entityId: thread.id,
          requiresAction: false,
          deliveredAt: now,
          dedupeKey: `chat-participant-added:${thread.id}:${input.userId}:v${input.expectedThreadVersion + 1}`,
        },
        update: {},
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.participant_added',
          entityType: 'MESSAGE_THREAD',
          entityId: thread.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ role: input.role, participantCount: 1 }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: thread.id,
          aggregateVersion: input.expectedThreadVersion + 1,
          eventType: 'message.participant_added',
          safePayload: JSON.stringify({
            threadId: thread.id,
            companyId: thread.companyId,
          }),
        },
      })
      return participant
    })
    const usersById = await this.safeUsers([result.userId])
    void this.realtime.publish(thread.id, 'participant.updated').catch(() => undefined)
    return {
      participant: this.participantView(result, usersById),
      threadVersion: input.expectedThreadVersion + 1,
    }
  }

  async updateParticipant(
    principal: AuthPrincipal,
    threadId: string,
    userId: string,
    input: UpdateChatParticipantInput,
  ): Promise<{ participant: ChatParticipantView; threadVersion: number }> {
    const thread = await this.readableThread(principal, threadId)
    this.assertParticipantManager(principal, thread)
    const target = thread.participants.find(
      (participant) => participant.userId === userId && !participant.leftAt,
    )
    if (!target) throw notFound()
    if (target.version !== input.expectedVersion) {
      throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
    }
    if (target.role === input.role) {
      const usersById = await this.safeUsers([target.userId])
      return {
        participant: this.participantView(target, usersById),
        threadVersion: thread.version,
      }
    }
    if (
      target.role === 'OWNER'
      && input.role !== 'OWNER'
      && thread.participants.filter(
        (participant) => participant.role === 'OWNER' && !participant.leftAt,
      ).length <= 1
    ) {
      throw conflict('Спочатку призначте іншого власника діалогу.')
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.messageThread.updateMany({
        where: { id: thread.id, version: input.expectedThreadVersion },
        data: { version: { increment: 1 } },
      })
      if (aggregate.count !== 1) {
        throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
      }
      const changed = await tx.threadParticipant.updateMany({
        where: {
          id: target.id,
          version: input.expectedVersion,
          leftAt: null,
        },
        data: {
          role: input.role,
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.participant_role_changed',
          entityType: 'MESSAGE_THREAD',
          entityId: thread.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ from: target.role, to: input.role }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: thread.id,
          aggregateVersion: input.expectedThreadVersion + 1,
          eventType: 'message.participant_role_changed',
          safePayload: JSON.stringify({ threadId: thread.id, companyId: thread.companyId }),
        },
      })
      return tx.threadParticipant.findUniqueOrThrow({ where: { id: target.id } })
    })
    const usersById = await this.safeUsers([updated.userId])
    void this.realtime.publish(thread.id, 'participant.updated').catch(() => undefined)
    return {
      participant: this.participantView(updated, usersById),
      threadVersion: input.expectedThreadVersion + 1,
    }
  }

  async removeParticipant(
    principal: AuthPrincipal,
    threadId: string,
    userId: string,
    input: RemoveChatParticipantInput,
  ): Promise<{ userId: string; left: true; threadVersion: number }> {
    const thread = await this.readableThread(principal, threadId)
    this.assertCollaborativeThread(thread)
    const actor = thread.participants.find(
      (participant) => participant.userId === principal.userId && !participant.leftAt,
    )
    const target = thread.participants.find(
      (participant) => participant.userId === userId && !participant.leftAt,
    )
    if (!actor || !target) throw notFound()
    const canManage = actor.role === 'OWNER' || isGlobalAdmin(principal)
    if (target.userId !== principal.userId && !canManage) throw notFound()
    if (target.version !== input.expectedVersion) {
      throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
    }
    const activeParticipants = thread.participants.filter((participant) => !participant.leftAt)
    if (thread.kind === 'GROUP' && activeParticipants.length <= 2) {
      throw conflict('У груповому діалозі мають залишитися щонайменше два учасники.')
    }
    if (
      target.role === 'OWNER'
      && activeParticipants.filter((participant) => participant.role === 'OWNER').length <= 1
    ) {
      throw conflict('Спочатку призначте іншого власника діалогу.')
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.messageThread.updateMany({
        where: { id: thread.id, version: input.expectedThreadVersion },
        data: { version: { increment: 1 } },
      })
      if (aggregate.count !== 1) {
        throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
      }
      const removed = await tx.threadParticipant.updateMany({
        where: {
          id: target.id,
          version: input.expectedVersion,
          leftAt: null,
        },
        data: {
          leftAt: now,
          version: { increment: 1 },
        },
      })
      if (removed.count !== 1) {
        throw conflict('Склад діалогу вже змінився. Оновіть сторінку.')
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: target.userId === principal.userId
            ? 'message.participant_left'
            : 'message.participant_removed',
          entityType: 'MESSAGE_THREAD',
          entityId: thread.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ participantCount: -1 }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: thread.id,
          aggregateVersion: input.expectedThreadVersion + 1,
          eventType: 'message.participant_removed',
          safePayload: JSON.stringify({ threadId: thread.id, companyId: thread.companyId }),
        },
      })
    })
    void this.realtime.publish(thread.id, 'participant.updated').catch(() => undefined)
    return {
      userId: target.userId,
      left: true,
      threadVersion: input.expectedThreadVersion + 1,
    }
  }

  async editMessage(
    principal: AuthPrincipal,
    messageId: string,
    input: EditChatMessageInput,
  ): Promise<{ id: string; body: string; editedAt: string; version: number }> {
    const message = await this.readableMessage(principal, messageId)
    const thread = await this.readableThread(principal, message.threadId)
    if (
      message.authorId !== principal.userId
      && !isGlobalAdmin(principal)
    ) throw notFound()
    if (message.deletedAt) throw notFound()
    const body = input.body.trim()
    const currentMentions = await this.prisma.contentMention.findMany({
      where: {
        workspaceId: principal.workspaceId,
        sourceType: 'MESSAGE',
        sourceId: message.id,
      },
      select: { userId: true, start: true, end: true, label: true },
      orderBy: { start: 'asc' },
    })
    const nextMentions = input.mentions?.toSorted((left, right) => left.start - right.start || left.end - right.end)
    const mentionedUserIds = nextMentions
      ? this.validateStructuredMentions(body, nextMentions)
      : []
    if (nextMentions?.length) {
      await this.assertMessageMentionRecipients(
        principal,
        thread,
        mentionedUserIds,
        currentMentions.map((mention) => mention.userId),
      )
    }
    const mentionsChanged = nextMentions
      ? !this.sameStructuredMentions(currentMentions, nextMentions)
      : currentMentions.length > 0
    if (message.version !== input.expectedVersion) {
      throw conflict('Повідомлення вже змінилося. Оновіть діалог.')
    }
    if (message.body === body && !mentionsChanged) {
      return {
        id: message.id,
        body: message.body,
        editedAt: message.editedAt?.toISOString() ?? message.createdAt.toISOString(),
        version: message.version,
      }
    }
    const editedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.message.updateMany({
        where: {
          id: message.id,
          version: input.expectedVersion,
          deletedAt: null,
        },
        data: {
          body,
          editedAt,
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw conflict('Повідомлення вже змінилося. Оновіть діалог.')
      }
      if (mentionsChanged) {
        await tx.contentMention.deleteMany({
          where: {
            workspaceId: principal.workspaceId,
            sourceType: 'MESSAGE',
            sourceId: message.id,
          },
        })
        if (nextMentions?.length) {
          await tx.contentMention.createMany({
            data: nextMentions.map((mention) => ({
              id: id('mnt'),
              workspaceId: principal.workspaceId,
              sourceType: 'MESSAGE',
              sourceId: message.id,
              ...mention,
            })),
          })
        }
      }
      const aggregate = await tx.messageThread.update({
        where: { id: message.threadId },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      if (nextMentions) {
        const previousMentioned = new Set(currentMentions.map((mention) => mention.userId))
        const newlyMentioned = mentionedUserIds.filter((userId) => !previousMentioned.has(userId))
        for (const participant of thread.participants) {
          if (
            participant.userId === principal.userId
            || participant.leftAt
            || participant.notificationMode !== 'ALL'
            || !newlyMentioned.includes(participant.userId)
          ) continue
          await tx.notification.create({
            data: {
              id: id('ntf'),
              recipientId: participant.userId,
              category: 'MENTION',
              safeTitle: 'Вас згадали у повідомленні',
              safeSnippet: 'Відкрийте діалог, щоб переглянути згадку.',
              entityType: 'MESSAGE_THREAD',
              entityId: message.threadId,
              requiresAction: false,
              deliveredAt: editedAt,
              dedupeKey: `chat:${message.id}:mention:v${input.expectedVersion + 1}:${participant.userId}`,
            },
          })
        }
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: message.thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.edited',
          entityType: 'MESSAGE',
          entityId: message.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({
            ...(nextMentions ? { mentionCount: mentionedUserIds.length } : {}),
          }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: message.threadId,
          aggregateVersion: aggregate.version,
          eventType: 'message.edited',
          safePayload: JSON.stringify({
            threadId: message.threadId,
            messageId: message.id,
            companyId: message.thread.companyId,
          }),
        },
      })
    })
    void this.realtime.publish(message.threadId, 'message.edited', message.id).catch(() => undefined)
    return {
      id: message.id,
      body,
      editedAt: editedAt.toISOString(),
      version: input.expectedVersion + 1,
    }
  }

  async deleteMessage(
    principal: AuthPrincipal,
    messageId: string,
    input: DeleteChatMessageInput,
  ): Promise<{ id: string; deletedAt: string; version: number }> {
    const message = await this.readableMessage(principal, messageId)
    if (
      message.authorId !== principal.userId
      && !isGlobalAdmin(principal)
    ) throw notFound()
    if (message.deletedAt) {
      return {
        id: message.id,
        deletedAt: message.deletedAt.toISOString(),
        version: message.version,
      }
    }
    const deletedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.message.updateMany({
        where: {
          id: message.id,
          version: input.expectedVersion,
          deletedAt: null,
        },
        data: {
          deletedAt,
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw conflict('Повідомлення вже змінилося. Оновіть діалог.')
      }
      const aggregate = await tx.messageThread.update({
        where: { id: message.threadId },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: message.thread.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'message.deleted',
          entityType: 'MESSAGE',
          entityId: message.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'MESSAGE_THREAD',
          aggregateId: message.threadId,
          aggregateVersion: aggregate.version,
          eventType: 'message.deleted',
          safePayload: JSON.stringify({
            threadId: message.threadId,
            messageId: message.id,
            companyId: message.thread.companyId,
          }),
        },
      })
    })
    void this.realtime.publish(message.threadId, 'message.deleted', message.id).catch(() => undefined)
    return {
      id: message.id,
      deletedAt: deletedAt.toISOString(),
      version: input.expectedVersion + 1,
    }
  }

  async markRead(
    principal: AuthPrincipal,
    threadId: string,
    input: MarkChatReadInput,
  ): Promise<{ lastReadMessageId: string; participantVersion: number }> {
    const thread = await this.readableThread(principal, threadId)
    const target = await this.prisma.message.findFirst({
      where: { id: input.lastReadMessageId, threadId },
    })
    if (!target) throw badRequest('chat_read_message_invalid')
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    if (!participant) throw notFound()
    const current = participant.lastReadMessageId
      ? await this.prisma.message.findUnique({ where: { id: participant.lastReadMessageId } })
      : null
    if (current && !this.messageAfter(target, current)) {
      return {
        lastReadMessageId: current.id,
        participantVersion: participant.version,
      }
    }
    const updated = await this.prisma.threadParticipant.update({
      where: { id: participant.id },
      data: {
        lastReadMessageId: target.id,
        version: { increment: 1 },
      },
      select: {
        lastReadMessageId: true,
        version: true,
      },
    })
    void this.realtime.publish(threadId, 'thread.read').catch(() => undefined)
    return {
      lastReadMessageId: updated.lastReadMessageId!,
      participantVersion: updated.version,
    }
  }

  async updatePreference(
    principal: AuthPrincipal,
    threadId: string,
    input: UpdateChatPreferenceInput,
  ): Promise<{ notificationMode: ChatNotificationMode; participantVersion: number }> {
    const thread = await this.readableThread(principal, threadId)
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    if (!participant) throw notFound()
    if (participant.notificationMode === input.notificationMode) {
      return {
        notificationMode: this.notificationMode(participant.notificationMode),
        participantVersion: participant.version,
      }
    }
    const result = await this.prisma.threadParticipant.updateMany({
      where: {
        id: participant.id,
        version: input.expectedVersion,
        leftAt: null,
      },
      data: {
        notificationMode: input.notificationMode,
        version: { increment: 1 },
      },
    })
    if (result.count !== 1) {
      throw conflict('Налаштування діалогу вже змінилися. Оновіть сторінку.')
    }
    void this.realtime.publish(thread.id, 'thread.updated').catch(() => undefined)
    return {
      notificationMode: input.notificationMode,
      participantVersion: input.expectedVersion + 1,
    }
  }

  async createTask(
    principal: AuthPrincipal,
    messageId: string,
    input: ConvertChatMessageToTaskInput,
    idempotencyKey: string,
  ) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        thread: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
          participants: {
            some: {
              userId: principal.userId,
              leftAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        body: true,
        thread: {
          select: {
            companyId: true,
          },
        },
      },
    })
    if (!message?.thread.companyId) throw notFound()
    const task = await this.taskCommands.create(
      principal,
      {
        title: input.title,
        description: message.body,
        reporterId: principal.userId,
        priority: 'MEDIUM',
        dueAt: input.deadline,
        participants: [{ userId: input.assigneeId, role: 'RESPONSIBLE' }],
        checklistItems: [],
        tagIds: [],
        relations: [],
        reminders: [],
        recurrence: null,
        attachmentIds: [],
      },
      idempotencyKey,
    )
    await this.prisma.entityLink.upsert({
      where: {
        sourceType_sourceId_targetType_targetId_relation: {
          sourceType: 'MESSAGE',
          sourceId: message.id,
          targetType: 'TASK',
          targetId: task.id,
          relation: 'RELATED',
        },
      },
      create: {
        id: id('lnk'),
        sourceType: 'MESSAGE',
        sourceId: message.id,
        targetType: 'TASK',
        targetId: task.id,
        relation: 'RELATED',
        createdBy: principal.userId,
      },
      update: {},
    })
    return task
  }

  private async readableThread(
    principal: AuthPrincipal,
    threadId: string,
  ): Promise<ThreadWithParticipants> {
    const thread = await this.prisma.messageThread.findFirst({
      where: {
        id: threadId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
        participants: {
          some: {
            userId: principal.userId,
            leftAt: null,
          },
        },
      },
      include: {
        participants: true,
      },
    })
    if (!thread) throw notFound()
    await this.assertThreadContextAccess(principal, thread)
    return thread
  }

  private async readableMessage(principal: AuthPrincipal, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        thread: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
          participants: {
            some: {
              userId: principal.userId,
              leftAt: null,
            },
          },
        },
      },
      include: {
        thread: {
          select: {
            id: true,
            companyId: true,
            entityType: true,
            entityId: true,
          },
        },
      },
    })
    if (!message) throw notFound()
    await this.assertThreadContextAccess(principal, message.thread)
    return message
  }

  private async assertThreadContextAccess(
    principal: AuthPrincipal,
    thread: Pick<MessageThread, 'entityType' | 'entityId'>,
  ): Promise<void> {
    if (thread.entityType !== 'GROUP') return
    if (!thread.entityId) throw notFound()
    const membership = await this.prisma.groupMember.findFirst({
      where: {
        groupId: thread.entityId,
        userId: principal.userId,
        leftAt: null,
        group: {
          workspaceId: principal.workspaceId,
          companyId: { in: principal.allowedCompanyIds },
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    })
    if (!membership) throw notFound()
  }

  private assertMentionableThread(thread: Pick<MessageThread, 'kind'>): void {
    if (thread.kind !== 'DIRECT' && thread.kind !== 'GROUP') {
      throw badRequest('chat_mentions_unavailable')
    }
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
        throw badRequest('chat_mention_invalid')
      }
      previousEnd = mention.end
    }
    return [...new Set(ordered.map((mention) => mention.userId))]
  }

  private async assertMessageMentionRecipients(
    principal: AuthPrincipal,
    thread: ThreadWithParticipants,
    userIds: string[],
    previousUserIds: string[] = [],
  ): Promise<void> {
    this.assertMentionableThread(thread)
    const companyId = thread.companyId
    if (!companyId) throw notFound()
    const currentParticipantIds = new Set(thread.participants
      .filter((participant) => !participant.leftAt)
      .map((participant) => participant.userId))
    const previous = new Set(previousUserIds)
    if (userIds.some((userId) => !currentParticipantIds.has(userId) && !previous.has(userId))) {
      throw badRequest('chat_mention_outside_thread')
    }
    const newlyMentioned = userIds.filter((userId) => !previous.has(userId))
    if (!newlyMentioned.length) return
    const activeUsers = await this.prisma.user.findMany({
      where: {
        id: { in: newlyMentioned },
        workspaceId: principal.workspaceId,
        isActive: true,
        OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }],
      },
      select: { id: true },
    })
    if (activeUsers.length !== newlyMentioned.length) throw badRequest('chat_mention_outside_thread')
  }

  private sameStructuredMentions(
    current: Array<{ userId: string; start: number; end: number; label: string }>,
    next: StructuredMentionInput[],
  ): boolean {
    return current.length === next.length && current.every((mention, index) => {
      const candidate = next[index]
      return candidate?.userId === mention.userId
        && candidate.start === mention.start
        && candidate.end === mention.end
        && candidate.label === mention.label
    })
  }

  private assertCollaborativeThread(thread: ThreadWithParticipants): void {
    if (
      (thread.kind !== 'GROUP' && thread.kind !== 'CONTEXTUAL')
      || thread.entityType === 'GROUP'
    ) {
      throw badRequest('chat_participant_management_unavailable')
    }
  }

  private assertParticipantManager(
    principal: AuthPrincipal,
    thread: ThreadWithParticipants,
  ): ThreadParticipant {
    this.assertCollaborativeThread(thread)
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    if (
      !participant
      || (
        participant.role !== 'OWNER'
        && !isGlobalAdmin(principal)
      )
    ) throw notFound()
    return participant
  }

  private async messageViews(
    principal: AuthPrincipal,
    thread: ThreadWithParticipants,
    messages: Message[],
  ): Promise<ChatMessageView[]> {
    if (!messages.length) return []
    const replyIds = messages.flatMap((message) => message.replyToId ? [message.replyToId] : [])
    const missingReplyIds = replyIds.filter(
      (replyId) => !messages.some((message) => message.id === replyId),
    )
    const [replyMessages, attachmentLinks, contentMentions] = await Promise.all([
      missingReplyIds.length
        ? this.prisma.message.findMany({
            where: { id: { in: [...new Set(missingReplyIds)] }, threadId: thread.id },
          })
        : [],
      this.prisma.fileLink.findMany({
        where: {
          entityType: 'MESSAGE',
          entityId: { in: messages.map((message) => message.id) },
          purpose: 'ATTACHMENT',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.contentMention.findMany({
        where: {
          workspaceId: principal.workspaceId,
          sourceType: 'MESSAGE',
          sourceId: { in: messages.map((message) => message.id) },
        },
        orderBy: { start: 'asc' },
      }),
    ])
    const attachmentFiles = attachmentLinks.length
      ? await this.prisma.fileObject.findMany({
          where: {
            id: { in: [...new Set(attachmentLinks.map((link) => link.fileId))] },
            workspaceId: principal.workspaceId,
            companyId: thread.companyId!,
          },
        })
      : []
    const mentionUsers = contentMentions.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: [...new Set(contentMentions.map((mention) => mention.userId))] },
            workspaceId: principal.workspaceId,
          },
          select: { id: true, primaryCompanyId: true, accountType: true, isActive: true },
        })
      : []
    const allMessages = [...messages, ...replyMessages]
    const usersById = await this.safeUsers(allMessages.map((message) => message.authorId))
    const messagesById = new Map(allMessages.map((message) => [message.id, message]))
    const filesById = new Map(attachmentFiles.map((file) => [file.id, file]))
    const mentionUserById = new Map(mentionUsers.map((user) => [user.id, user]))
    const activeParticipantIds = new Set(thread.participants
      .filter((participant) => !participant.leftAt)
      .map((participant) => participant.userId))
    const mentionsByMessage = new Map<string, StructuredMentionView[]>()
    for (const mention of contentMentions) {
      const user = mentionUserById.get(mention.userId)
      const current = mentionsByMessage.get(mention.sourceId) ?? []
      current.push({
        userId: mention.userId,
        start: mention.start,
        end: mention.end,
        active: Boolean(
          activeParticipantIds.has(mention.userId)
          && user?.isActive
          && (user.primaryCompanyId === thread.companyId || user.accountType === 'ADMIN'),
        ),
      })
      mentionsByMessage.set(mention.sourceId, current)
    }
    const attachmentsByMessage = new Map<string, ChatAttachmentView[]>()
    for (const link of attachmentLinks) {
      const file = filesById.get(link.fileId)
      if (!file) continue
      const current = attachmentsByMessage.get(link.entityId) ?? []
      current.push(this.attachmentView(file))
      attachmentsByMessage.set(link.entityId, current)
    }
    return messages.map((message) => this.messageView(
      principal,
      message,
      messagesById,
      usersById,
      attachmentsByMessage.get(message.id) ?? [],
      mentionsByMessage.get(message.id) ?? [],
    ))
  }

  private async visibleChatGroupIds(
    principal: AuthPrincipal,
    companyIds: string[],
  ): Promise<string[]> {
    const memberships = await this.prisma.groupMember.findMany({
      where: {
        userId: principal.userId,
        leftAt: null,
        group: {
          workspaceId: principal.workspaceId,
          companyId: { in: companyIds },
          status: 'ACTIVE',
        },
      },
      select: { groupId: true },
    })
    return memberships.map((membership) => membership.groupId)
  }

  private visibleThreadWhere(groupIds: string[]): Prisma.MessageThreadWhereInput {
    return {
      OR: [
        { entityType: null },
        { entityType: { not: 'GROUP' } },
        ...(groupIds.length
          ? [{ entityType: 'GROUP', entityId: { in: groupIds } }]
          : []),
      ],
    }
  }

  private async unreadThreadPageIds(
    principal: AuthPrincipal,
    companyIds: string[],
    groupIds: string[],
    cursor: ChatThreadCursor | null,
    limit: number,
  ): Promise<string[]> {
    if (!companyIds.length) return []
    const companyPlaceholders = companyIds.map(() => '?').join(', ')
    const groupVisibility = groupIds.length
      ? `(
          thread."entityType" IS NULL
          OR thread."entityType" <> 'GROUP'
          OR thread."entityId" IN (${groupIds.map(() => '?').join(', ')})
        )`
      : `(thread."entityType" IS NULL OR thread."entityType" <> 'GROUP')`
    let cursorSql = ''
    const cursorValues: Array<Date | string> = []
    if (cursor?.lastMessageAt) {
      cursorSql = `AND (
        thread."lastMessageAt" < ?
        OR thread."lastMessageAt" IS NULL
        OR (
          thread."lastMessageAt" = ?
          AND (
            thread."createdAt" < ?
            OR (thread."createdAt" = ? AND thread."id" < ?)
          )
        )
      )`
      const lastMessageAt = new Date(cursor.lastMessageAt)
      const createdAt = new Date(cursor.createdAt)
      cursorValues.push(lastMessageAt, lastMessageAt, createdAt, createdAt, cursor.id)
    } else if (cursor) {
      cursorSql = `AND thread."lastMessageAt" IS NULL
        AND (
          thread."createdAt" < ?
          OR (thread."createdAt" = ? AND thread."id" < ?)
        )`
      const createdAt = new Date(cursor.createdAt)
      cursorValues.push(createdAt, createdAt, cursor.id)
    }
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT thread."id" AS "id"
       FROM "MessageThread" AS thread
       JOIN "ThreadParticipant" AS participant
         ON participant."threadId" = thread."id"
        AND participant."userId" = ?
        AND participant."leftAt" IS NULL
       WHERE thread."workspaceId" = ?
         AND thread."companyId" IN (${companyPlaceholders})
         AND ${groupVisibility}
         AND EXISTS (
           SELECT 1
           FROM "Message" AS message
           LEFT JOIN "Message" AS marker
             ON marker."id" = participant."lastReadMessageId"
           WHERE message."threadId" = thread."id"
             AND message."deletedAt" IS NULL
             AND message."authorId" <> ?
             AND (
               marker."id" IS NULL
               OR message."createdAt" > marker."createdAt"
               OR (
                 message."createdAt" = marker."createdAt"
                 AND message."id" > marker."id"
               )
             )
         )
         ${cursorSql}
       ORDER BY thread."lastMessageAt" DESC, thread."createdAt" DESC, thread."id" DESC
       LIMIT ?`,
      principal.userId,
      principal.workspaceId,
      ...companyIds,
      ...groupIds,
      principal.userId,
      ...cursorValues,
      limit,
    )
    return rows.map((row) => row.id)
  }

  private async threadSummary(
    principal: AuthPrincipal,
    companyIds: string[],
    groupIds: string[],
  ): Promise<{ all: number; unread: number }> {
    if (!companyIds.length) return { all: 0, unread: 0 }
    const companyPlaceholders = companyIds.map(() => '?').join(', ')
    const groupVisibility = groupIds.length
      ? `(
          thread."entityType" IS NULL
          OR thread."entityType" <> 'GROUP'
          OR thread."entityId" IN (${groupIds.map(() => '?').join(', ')})
        )`
      : `(thread."entityType" IS NULL OR thread."entityType" <> 'GROUP')`
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      allCount: bigint | number
      unreadCount: bigint | number
    }>>(
      `SELECT
         COUNT(*) AS "allCount",
         COALESCE(SUM(
           CASE WHEN EXISTS (
             SELECT 1
             FROM "Message" AS message
             LEFT JOIN "Message" AS marker
               ON marker."id" = participant."lastReadMessageId"
             WHERE message."threadId" = thread."id"
               AND message."deletedAt" IS NULL
               AND message."authorId" <> ?
               AND (
                 marker."id" IS NULL
                 OR message."createdAt" > marker."createdAt"
                 OR (
                   message."createdAt" = marker."createdAt"
                   AND message."id" > marker."id"
                 )
               )
           ) THEN 1 ELSE 0 END
         ), 0) AS "unreadCount"
       FROM "MessageThread" AS thread
       JOIN "ThreadParticipant" AS participant
         ON participant."threadId" = thread."id"
        AND participant."userId" = ?
        AND participant."leftAt" IS NULL
       WHERE thread."workspaceId" = ?
         AND thread."companyId" IN (${companyPlaceholders})
         AND ${groupVisibility}`,
      principal.userId,
      principal.userId,
      principal.workspaceId,
      ...companyIds,
      ...groupIds,
    )
    return {
      all: Number(rows[0]?.allCount ?? 0),
      unread: Number(rows[0]?.unreadCount ?? 0),
    }
  }

  private async unreadCounts(userId: string, threadIds: string[]): Promise<Map<string, number>> {
    if (!threadIds.length) return new Map()
    const placeholders = threadIds.map(() => '?').join(', ')
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      threadId: string
      unreadCount: bigint | number
    }>>(
      `SELECT message."threadId" AS "threadId", COUNT(*) AS "unreadCount"
       FROM "Message" AS message
       JOIN "ThreadParticipant" AS participant
         ON participant."threadId" = message."threadId"
        AND participant."userId" = ?
        AND participant."leftAt" IS NULL
       LEFT JOIN "Message" AS marker
         ON marker."id" = participant."lastReadMessageId"
       WHERE message."threadId" IN (${placeholders})
         AND message."deletedAt" IS NULL
         AND message."authorId" <> ?
         AND (
           marker."id" IS NULL
           OR message."createdAt" > marker."createdAt"
           OR (message."createdAt" = marker."createdAt" AND message."id" > marker."id")
         )
       GROUP BY message."threadId"`,
      userId,
      ...threadIds,
      userId,
    )
    return new Map(rows.map((row) => [row.threadId, Number(row.unreadCount)]))
  }

  private contactUser(user: SafeUser): ChatContactUser {
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      jobTitle: user.jobTitle,
      avatarAsset: user.avatarAsset,
    }
  }

  private userSearchRank(
    user: Pick<User, 'normalizedUsername' | 'normalizedDisplayName'>,
    query: string,
  ): number {
    if (user.normalizedUsername === query) return 0
    if (user.normalizedUsername.startsWith(query)) return 1
    if (user.normalizedDisplayName.split(' ').some((word) => word.startsWith(query))) return 2
    if (user.normalizedDisplayName.startsWith(query)) return 3
    if (user.normalizedDisplayName.includes(query)) return 4
    return 5
  }

  private recommendationUsers(
    principal: AuthPrincipal,
    companyId: string,
    userIds?: string[],
  ): Promise<SafeUser[]> {
    return this.prisma.user.findMany({
      where: {
        workspaceId: principal.workspaceId,
        isActive: true,
        OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }],
        id: {
          not: principal.userId,
          ...(userIds ? { in: userIds } : {}),
        },
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        jobTitle: true,
        avatarAsset: true,
      },
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
      take: 200,
    })
  }

  private threadCursorWhere(cursor: ChatThreadCursor): Prisma.MessageThreadWhereInput {
    const createdAt = new Date(cursor.createdAt)
    if (cursor.lastMessageAt) {
      const lastMessageAt = new Date(cursor.lastMessageAt)
      return {
        OR: [
          { lastMessageAt: { lt: lastMessageAt } },
          { lastMessageAt: null },
          {
            lastMessageAt,
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: cursor.id } },
            ],
          },
        ],
      }
    }
    return {
      lastMessageAt: null,
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ],
    }
  }

  private encodeThreadCursor(
    thread: Pick<MessageThread, 'lastMessageAt' | 'createdAt' | 'id'>,
  ): string {
    return encodeChatThreadCursor(thread)
  }

  private decodeThreadCursor(value: string): ChatThreadCursor {
    try {
      return decodeChatThreadCursor(value)
    } catch {
      throw badRequest('chat_thread_cursor_invalid')
    }
  }

  private messageBeforeWhere(
    cursor: Pick<Message, 'createdAt' | 'id'> | ChatMessageCursor,
  ): Prisma.MessageWhereInput {
    const createdAt = cursor.createdAt instanceof Date
      ? cursor.createdAt
      : new Date(cursor.createdAt)
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ],
    }
  }

  private messageAfterWhere(
    cursor: Pick<Message, 'createdAt' | 'id'> | ChatMessageCursor,
  ): Prisma.MessageWhereInput {
    const createdAt = cursor.createdAt instanceof Date
      ? cursor.createdAt
      : new Date(cursor.createdAt)
    return {
      OR: [
        { createdAt: { gt: createdAt } },
        { createdAt, id: { gt: cursor.id } },
      ],
    }
  }

  private encodeMessageCursor(
    message: Pick<Message, 'createdAt' | 'id'>,
  ): string {
    return encodeChatMessageCursor(message)
  }

  private decodeMessageCursor(value: string): ChatMessageCursor {
    try {
      return decodeChatMessageCursor(value)
    } catch {
      throw badRequest('chat_message_cursor_invalid')
    }
  }

  private async safeUsers(userIds: string[]): Promise<Map<string, SafeUser>> {
    const uniqueIds = [...new Set(userIds)]
    if (!uniqueIds.length) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        displayName: true,
        username: true,
        jobTitle: true,
        avatarAsset: true,
      },
    })
    return new Map(users.map((user) => [user.id, user]))
  }

  private async assertActiveCompanyUsers(companyId: string, userIds: string[]): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        isActive: true,
        OR: [{ primaryCompanyId: companyId }, { accountType: 'ADMIN' }],
      },
      select: { id: true },
    })
    if (users.length !== userIds.length) throw badRequest('chat_participants_invalid')
  }

  private async findDirectThread(
    workspaceId: string,
    companyId: string,
    userIds: string[],
    directKey: string,
  ): Promise<(MessageThread & { participants: ThreadParticipant[] }) | null> {
    const byKey = await this.prisma.messageThread.findUnique({
      where: { directKey },
      include: { participants: true },
    })
    if (byKey) return byKey
    const candidates = await this.prisma.messageThread.findMany({
      where: {
        workspaceId,
        companyId,
        kind: 'DIRECT',
        participants: {
          some: {
            userId: userIds[0],
            leftAt: null,
          },
        },
      },
      include: { participants: true },
      take: 50,
    })
    return candidates.find((thread) => {
      const activeIds = thread.participants
        .filter((participant) => !participant.leftAt)
        .map((participant) => participant.userId)
        .sort()
      return activeIds.length === userIds.length
        && activeIds.every((userId, index) => userId === userIds[index])
    }) ?? null
  }

  private async idempotentResult(
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<string | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId,
          key,
          operation,
        },
      },
    })
    if (existing && existing.requestFingerprint !== requestFingerprint) {
      throw conflict('Цей ключ повтору вже використано для іншого запиту.')
    }
    return existing?.resultId ?? null
  }

  private threadListItem(
    principal: AuthPrincipal,
    thread: ThreadListRow,
    usersById: Map<string, SafeUser>,
    unreadCount: number,
  ): ChatThreadListItem {
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    const otherParticipant = thread.participants.find(
      (entry) => entry.userId !== principal.userId && !entry.leftAt,
    )
    const lastMessage = thread.messages[0] ?? null
    return {
      id: thread.id,
      companyId: thread.companyId!,
      title: this.threadTitle(principal.userId, thread, usersById),
      kind: this.threadKind(thread.kind),
      avatarAsset: thread.kind === 'DIRECT' && otherParticipant
        ? usersById.get(otherParticipant.userId)?.avatarAsset ?? null
        : null,
      previewParticipants: thread.participants
        .filter((entry) => entry.userId !== principal.userId && !entry.leftAt)
        .slice(0, 3)
        .flatMap((entry) => {
          const user = usersById.get(entry.userId)
          return user ? [this.contactUser(user)] : []
        }),
      participantCount: thread.participants.filter((entry) => !entry.leftAt).length,
      lastMessageAt: lastMessage?.createdAt.toISOString()
        ?? thread.lastMessageAt?.toISOString()
        ?? null,
      lastMessage: lastMessage?.body ?? '',
      lastMessageId: lastMessage?.id ?? null,
      unread: unreadCount > 0,
      unreadCount,
      notificationMode: this.notificationMode(participant?.notificationMode),
    }
  }

  private participantView(
    participant: ThreadParticipant,
    usersById: Map<string, SafeUser>,
  ): ChatParticipantView {
    const user = usersById.get(participant.userId)
    return {
      id: participant.userId,
      displayName: user?.displayName ?? 'Користувач',
      username: user?.username ?? '',
      jobTitle: user?.jobTitle ?? '',
      avatarAsset: user?.avatarAsset ?? null,
      role: participant.role === 'OWNER' ? 'OWNER' : 'MEMBER',
      version: participant.version,
    }
  }

  private messageView(
    principal: AuthPrincipal,
    message: Message,
    messagesById: Map<string, Message>,
    usersById: Map<string, SafeUser>,
    attachments: ChatAttachmentView[],
    mentions: StructuredMentionView[],
  ): ChatMessageView {
    const author = usersById.get(message.authorId)
    const reply = message.replyToId ? messagesById.get(message.replyToId) : null
    const replyAuthor = reply ? usersById.get(reply.authorId) : null
    const deleted = Boolean(message.deletedAt)
    const canManage = isGlobalAdmin(principal)
    return {
      id: message.id,
      authorId: message.authorId,
      body: deleted ? '' : message.body,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      version: message.version,
      replyToId: message.replyToId,
      mentions: deleted ? [] : mentions,
      replyPreview: reply
        ? {
            id: reply.id,
            authorName: replyAuthor?.displayName ?? 'Користувач',
            body: reply.deletedAt ? 'Повідомлення видалено' : reply.body.slice(0, 180),
          }
        : null,
      author: {
        id: message.authorId,
        displayName: author?.displayName ?? 'Користувач',
        avatarAsset: author?.avatarAsset ?? null,
      },
      attachments: deleted ? [] : attachments,
      canEdit: !deleted && (message.authorId === principal.userId || canManage),
      canDelete: !deleted && (message.authorId === principal.userId || canManage),
    }
  }

  private attachmentView(file: FileObject): ChatAttachmentView {
    return {
      id: file.id,
      fileName: file.safeFilename,
      bytes: file.bytes,
      mimeType: file.detectedMime ?? file.declaredMime ?? null,
      scanStatus: file.scanStatus,
    }
  }

  private threadTitle(
    userId: string,
    thread: Pick<MessageThread, 'kind' | 'title'> & { participants: ThreadParticipant[] },
    usersById: Map<string, SafeUser>,
  ): string {
    if (thread.kind === 'DIRECT') {
      const other = thread.participants.find(
        (participant) => participant.userId !== userId && !participant.leftAt,
      )
      return other ? usersById.get(other.userId)?.displayName ?? 'Особистий діалог' : 'Особистий діалог'
    }
    return thread.title?.trim() || 'Робочий діалог'
  }

  private threadKind(value: string): ChatThreadKind {
    if (value === 'DIRECT' || value === 'GROUP' || value === 'COMPANY') return value
    return 'CONTEXTUAL'
  }

  private notificationMode(value?: string): ChatNotificationMode {
    return value === 'NONE' ? 'NONE' : 'ALL'
  }

  private messageAfter(next: Message, current: Message): boolean {
    const nextTime = next.createdAt.getTime()
    const currentTime = current.createdAt.getTime()
    return nextTime > currentTime || (nextTime === currentTime && next.id > current.id)
  }

  private chatFingerprint(purpose: string, value: unknown): string {
    return fingerprint(JSON.stringify(value), purpose)
  }
}
