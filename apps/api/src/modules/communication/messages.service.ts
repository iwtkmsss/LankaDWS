import { Injectable } from '@nestjs/common'
import {
  Permission,
  type AddChatParticipantInput,
  type ChatAttachmentView,
  type ChatMessageView,
  type ChatNotificationMode,
  type ChatParticipantView,
  type ChatThreadDetail,
  type ChatThreadKind,
  type ChatThreadListItem,
  type ChatThreadListQuery,
  type CreateChatThreadInput,
  type ConvertChatMessageToTaskInput,
  type DeleteChatMessageInput,
  type EditChatMessageInput,
  type MarkChatReadInput,
  type RemoveChatParticipantInput,
  type SendChatMessageInput,
  type UpdateChatParticipantInput,
  type UpdateChatPreferenceInput,
} from '@bert-crm/contracts'
import { fingerprint, id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { FileObject, Message, MessageThread, ThreadParticipant, User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { TasksService } from '../tasks/tasks.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'

type SafeUser = Pick<User, 'id' | 'displayName' | 'avatarAsset'>
type ThreadWithContent = MessageThread & {
  participants: ThreadParticipant[]
  messages: Message[]
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly files: FilesService,
    private readonly tasks: TasksService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  async threads(
    principal: AuthPrincipal,
    query: ChatThreadListQuery,
  ): Promise<{ items: ChatThreadListItem[]; counts: { all: number; unread: number } }> {
    const companyIds = this.scope.allowedCompanies(principal, query.company)
    const matchingUserIds = query.query
      ? await this.matchingUserIds(principal.workspaceId, companyIds, query.query)
      : []
    const rows = await this.prisma.messageThread.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        participants: {
          some: {
            userId: principal.userId,
            leftAt: null,
          },
        },
        ...(query.query
          ? {
              OR: [
                { title: { contains: query.query } },
                {
                  messages: {
                    some: {
                      body: { contains: query.query },
                      deletedAt: null,
                    },
                  },
                },
                ...(matchingUserIds.length
                  ? [{
                      participants: {
                        some: {
                          userId: { in: matchingUserIds },
                          leftAt: null,
                        },
                      },
                    }]
                  : []),
              ],
            }
          : {}),
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
      take: 100,
    })
    const groupContextIds = rows
      .filter((thread) => thread.entityType === 'GROUP' && thread.entityId)
      .map((thread) => thread.entityId!)
    const groupMemberships = groupContextIds.length ? await this.prisma.groupMember.findMany({
      where: {
        groupId: { in: groupContextIds },
        userId: principal.userId,
        leftAt: null,
        group: { status: 'ACTIVE' },
      },
      select: { groupId: true },
    }) : []
    const allowedGroupIds = new Set(groupMemberships.map((membership) => membership.groupId))
    const authorizedRows = rows.filter((thread) =>
      thread.entityType !== 'GROUP'
      || Boolean(thread.entityId && allowedGroupIds.has(thread.entityId)),
    )
    const usersById = await this.safeUsers(
      authorizedRows.flatMap((thread) => thread.participants.map((participant) => participant.userId)),
    )
    const allItems = authorizedRows.map((thread) => this.threadListItem(principal, thread, usersById))
    const unreadCount = allItems.filter((thread) => thread.unread).length
    return {
      items: query.unread ? allItems.filter((thread) => thread.unread) : allItems,
      counts: { all: allItems.length, unread: unreadCount },
    }
  }

  async summary(
    principal: AuthPrincipal,
    company?: string,
  ): Promise<{ all: number; unread: number }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const rows = await this.prisma.messageThread.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: { in: companyIds },
        participants: {
          some: { userId: principal.userId, leftAt: null },
        },
      },
      select: {
        entityType: true,
        entityId: true,
        participants: {
          where: { userId: principal.userId, leftAt: null },
          select: { lastReadMessageId: true },
          take: 1,
        },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, authorId: true },
          take: 1,
        },
      },
    })
    const groupIds = rows
      .filter((thread) => thread.entityType === 'GROUP' && thread.entityId)
      .map((thread) => thread.entityId!)
    const memberships = groupIds.length
      ? await this.prisma.groupMember.findMany({
          where: {
            groupId: { in: groupIds },
            userId: principal.userId,
            leftAt: null,
            group: { status: 'ACTIVE' },
          },
          select: { groupId: true },
        })
      : []
    const allowedGroupIds = new Set(memberships.map((membership) => membership.groupId))
    const visible = rows.filter((thread) =>
      thread.entityType !== 'GROUP'
      || Boolean(thread.entityId && allowedGroupIds.has(thread.entityId)),
    )
    const unread = visible.filter((thread) => {
      const latest = thread.messages[0]
      return Boolean(
        latest
        && latest.authorId !== principal.userId
        && thread.participants[0]?.lastReadMessageId !== latest.id,
      )
    }).length
    return { all: visible.length, unread }
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
          await tx.idempotencyRecord.create({
            data: {
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
          })
        })
        return { id: existingDirect.id, created: false }
      }
    }

    const threadId = id('thr')
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
              status: 'ACTIVE',
              companyAccess: { some: { status: 'ACTIVE' } },
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
    const messageIds = thread.messages.map((message) => message.id)
    const attachmentLinks = messageIds.length
      ? await this.prisma.fileLink.findMany({
          where: {
            entityType: 'MESSAGE',
            entityId: { in: messageIds },
            purpose: 'ATTACHMENT',
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : []
    const attachmentFiles = attachmentLinks.length
      ? await this.prisma.fileObject.findMany({
          where: {
            id: { in: [...new Set(attachmentLinks.map((link) => link.fileId))] },
            workspaceId: principal.workspaceId,
            companyId: thread.companyId!,
          },
        })
      : []
    const usersById = await this.safeUsers([
      ...thread.participants.map((participant) => participant.userId),
      ...thread.messages.map((message) => message.authorId),
    ])
    const currentParticipant = thread.participants.find(
      (participant) => participant.userId === principal.userId && !participant.leftAt,
    )
    if (!currentParticipant) throw notFound()
    const messagesById = new Map(thread.messages.map((message) => [message.id, message]))
    const filesById = new Map(attachmentFiles.map((file) => [file.id, file]))
    const attachmentsByMessage = new Map<string, ChatAttachmentView[]>()
    for (const link of attachmentLinks) {
      const file = filesById.get(link.fileId)
      if (!file) continue
      const current = attachmentsByMessage.get(link.entityId) ?? []
      current.push(this.attachmentView(file))
      attachmentsByMessage.set(link.entityId, current)
    }
    const kind = this.threadKind(thread.kind)
    const isGroupContext = kind === 'CONTEXTUAL'
      && thread.entityType === 'GROUP'
      && Boolean(thread.entityId)
    const canManageParticipants = (
      kind === 'GROUP'
      || kind === 'CONTEXTUAL'
    ) && !isGroupContext && (
      currentParticipant.role === 'OWNER'
      || principal.permissions.has(Permission.MessagesManage)
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
      messages: thread.messages.map((message) => this.messageView(
        principal,
        message,
        messagesById,
        usersById,
        attachmentsByMessage.get(message.id) ?? [],
      )),
      lastMessageId: thread.messages.at(-1)?.id ?? null,
      canPost: principal.permissions.has(Permission.MessagesWrite),
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

  async post(
    principal: AuthPrincipal,
    threadId: string,
    input: SendChatMessageInput,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    if (!principal.permissions.has(Permission.MessagesWrite)) throw notFound()
    const thread = await this.readableThread(principal, threadId)
    const text = input.body.trim()
    const replyToId = input.replyToId ?? null
    const attachmentIds = input.attachmentIds
    if (!text || text.length > 8_000) throw badRequest('message_body')
    if (replyToId) {
      const parent = thread.messages.find((message) => message.id === replyToId)
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
            category: 'CHAT',
            safeTitle: 'Нове повідомлення',
            safeSnippet: 'У робочому діалозі є оновлення.',
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
    this.realtime.publish(threadId, 'message.created')
    return { id: messageId }
  }

  async uploadAttachment(
    principal: AuthPrincipal,
    threadId: string,
    file: UploadedBinary,
  ): Promise<ChatAttachmentView> {
    if (!principal.permissions.has(Permission.MessagesWrite)) throw notFound()
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
    const canManage = actor.role === 'OWNER' || principal.permissions.has(Permission.MessagesManage)
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
    if (
      message.authorId !== principal.userId
      && !principal.permissions.has(Permission.MessagesManage)
    ) throw notFound()
    if (message.deletedAt) throw notFound()
    const body = input.body.trim()
    if (message.version !== input.expectedVersion) {
      throw conflict('Повідомлення вже змінилося. Оновіть діалог.')
    }
    if (message.body === body) {
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
          action: 'message.edited',
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
          eventType: 'message.edited',
          safePayload: JSON.stringify({
            threadId: message.threadId,
            messageId: message.id,
            companyId: message.thread.companyId,
          }),
        },
      })
    })
    this.realtime.publish(message.threadId, 'message.edited')
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
      && !principal.permissions.has(Permission.MessagesManage)
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
    this.realtime.publish(message.threadId, 'message.deleted')
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
    const target = thread.messages.find((message) => message.id === input.lastReadMessageId)
    if (!target) throw badRequest('chat_read_message_invalid')
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    if (!participant) throw notFound()
    const current = participant.lastReadMessageId
      ? thread.messages.find((message) => message.id === participant.lastReadMessageId)
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
    return this.tasks.create(
      principal,
      {
        ...input,
        companyId: message.thread.companyId,
        description: message.body,
        related: { type: 'MESSAGE', id: message.id },
      },
      idempotencyKey,
    )
  }

  private async readableThread(
    principal: AuthPrincipal,
    threadId: string,
  ): Promise<ThreadWithContent> {
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
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 200,
        },
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

  private assertCollaborativeThread(thread: ThreadWithContent): void {
    if (
      (thread.kind !== 'GROUP' && thread.kind !== 'CONTEXTUAL')
      || thread.entityType === 'GROUP'
    ) {
      throw badRequest('chat_participant_management_unavailable')
    }
  }

  private assertParticipantManager(
    principal: AuthPrincipal,
    thread: ThreadWithContent,
  ): ThreadParticipant {
    this.assertCollaborativeThread(thread)
    const participant = thread.participants.find(
      (entry) => entry.userId === principal.userId && !entry.leftAt,
    )
    if (
      !participant
      || (
        participant.role !== 'OWNER'
        && !principal.permissions.has(Permission.MessagesManage)
      )
    ) throw notFound()
    return participant
  }

  private async matchingUserIds(
    workspaceId: string,
    companyIds: string[],
    query: string,
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        companyAccess: {
          some: {
            companyId: { in: companyIds },
            status: 'ACTIVE',
          },
        },
        OR: [
          { displayName: { contains: query } },
          { username: { contains: query } },
        ],
      },
      select: { id: true },
      take: 100,
    })
    return users.map((user) => user.id)
  }

  private async safeUsers(userIds: string[]): Promise<Map<string, SafeUser>> {
    const uniqueIds = [...new Set(userIds)]
    if (!uniqueIds.length) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        displayName: true,
        avatarAsset: true,
      },
    })
    return new Map(users.map((user) => [user.id, user]))
  }

  private async assertActiveCompanyUsers(companyId: string, userIds: string[]): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        status: 'ACTIVE',
        companyAccess: {
          some: {
            companyId,
            status: 'ACTIVE',
          },
        },
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
    thread: ThreadWithContent,
    usersById: Map<string, SafeUser>,
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
      participantCount: thread.participants.filter((entry) => !entry.leftAt).length,
      lastMessageAt: lastMessage?.createdAt.toISOString()
        ?? thread.lastMessageAt?.toISOString()
        ?? null,
      lastMessage: lastMessage?.body ?? '',
      lastMessageId: lastMessage?.id ?? null,
      unread: Boolean(
        lastMessage
        && lastMessage.authorId !== principal.userId
        && participant?.lastReadMessageId !== lastMessage.id,
      ),
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
  ): ChatMessageView {
    const author = usersById.get(message.authorId)
    const reply = message.replyToId ? messagesById.get(message.replyToId) : null
    const replyAuthor = reply ? usersById.get(reply.authorId) : null
    const deleted = Boolean(message.deletedAt)
    const canManage = principal.permissions.has(Permission.MessagesManage)
    return {
      id: message.id,
      authorId: message.authorId,
      body: deleted ? '' : message.body,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      version: message.version,
      replyToId: message.replyToId,
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
