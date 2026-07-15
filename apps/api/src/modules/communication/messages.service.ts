import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TasksService } from '../tasks/tasks.service.js'

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService, private readonly tasks: TasksService) {}

  async threads(principal: AuthPrincipal) {
    const rows = await this.prisma.messageThread.findMany({ where: { participants: { some: { userId: principal.userId, leftAt: null } } }, include: { participants: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { lastMessageAt: 'desc' } })
    return { items: rows.map((thread) => ({ id: thread.id, title: thread.title ?? 'Діалог', kind: thread.kind, entityType: thread.entityType, entityId: thread.entityId, lastMessageAt: thread.lastMessageAt?.toISOString() ?? null, lastMessage: thread.messages[0]?.body ?? '', unread: thread.participants.find((entry) => entry.userId === principal.userId)?.lastReadMessageId !== thread.messages[0]?.id })) }
  }

  async detail(principal: AuthPrincipal, threadId: string) {
    const thread = await this.prisma.messageThread.findFirst({ where: { id: threadId, participants: { some: { userId: principal.userId, leftAt: null } } }, include: { participants: true, messages: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 200 } } })
    if (!thread) throw notFound()
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(thread.messages.map((message) => message.authorId))] } }, select: { id: true, displayName: true, avatarAsset: true } })
    return { ...thread, messages: thread.messages.map((message) => ({ ...message, author: authors.find((author) => author.id === message.authorId) })) }
  }

  async post(principal: AuthPrincipal, threadId: string, body: string, replyToId?: string) {
    const thread = await this.prisma.messageThread.findFirst({ where: { id: threadId, participants: { some: { userId: principal.userId, leftAt: null } } } })
    if (!thread) throw notFound()
    const text = body.trim()
    if (!text || text.length > 8000) throw badRequest('message_body')
    const message = await this.prisma.message.create({ data: { id: id('msg'), threadId, authorId: principal.userId, body: text, replyToId } })
    await this.prisma.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: message.createdAt, version: { increment: 1 } } })
    return message
  }

  async createTask(principal: AuthPrincipal, messageId: string, input: { title: string; companyId?: string; assigneeId: string; deadline?: string }, idempotencyKey: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, thread: { participants: { some: { userId: principal.userId, leftAt: null } } } } })
    if (!message) throw notFound()
    return this.tasks.create(principal, { ...input, description: message.body, related: { type: 'MESSAGE', id: message.id } }, idempotencyKey)
  }
}
