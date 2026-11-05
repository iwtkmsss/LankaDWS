import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { id } from '../../common/crypto.js'
import { badRequest, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

const createTicket = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  attachmentIds: z.array(z.string().min(1)).max(20).default([]),
}).strict()

@Injectable()
export class FeedbackTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(principal: AuthPrincipal, input: unknown) {
    const parsed = createTicket.safeParse(input)
    if (!parsed.success) throw badRequest('validation_failed', 'Вкажіть тему й текст звернення (до 200 символів у темі, до 20 файлів).')
    const { title, body } = parsed.data
    const attachmentIds = [...new Set(parsed.data.attachmentIds)]
    const ticketId = id('ticket')
    await this.prisma.$transaction(async (tx) => {
      if (attachmentIds.length) {
        // Only fresh, clean uploads owned by the sender can become private attachments.
        const files = await tx.fileObject.findMany({ where: { id: { in: attachmentIds }, workspaceId: principal.workspaceId, ownerId: principal.userId, scanStatus: 'CLEAN', companyId: null }, select: { id: true } })
        const links = await tx.fileLink.count({ where: { fileId: { in: attachmentIds } } })
        if (files.length !== attachmentIds.length || links) throw badRequest('ticket_attachment_invalid')
      }
      await tx.feedbackTicket.create({ data: { id: ticketId, workspaceId: principal.workspaceId, ownerId: principal.userId, title, body } })
      if (attachmentIds.length) await tx.fileLink.createMany({ data: attachmentIds.map((fileId) => ({ id: id('fln'), fileId, entityType: 'FEEDBACK_TICKET', entityId: ticketId, purpose: 'ATTACHMENT', aclMode: 'INHERIT' })) })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'feedback.created', entityType: 'FEEDBACK_TICKET', entityId: ticketId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { submitted: true }
  }

  async list(principal: AuthPrincipal, cursor?: string) {
    this.assertAdmin(principal)
    const boundary = cursor ? await this.prisma.feedbackTicket.findFirst({ where: { id: cursor, workspaceId: principal.workspaceId }, select: { createdAt: true, id: true } }) : null
    if (cursor && !boundary) throw notFound()
    const rows = await this.prisma.feedbackTicket.findMany({
      where: { workspaceId: principal.workspaceId, status: 'ACTIVE', ...(boundary ? { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } : {}) },
      select: { id: true, title: true, ownerId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
    })
    const page = rows.slice(0, 20)
    const authors = page.length ? await this.prisma.user.findMany({ where: { workspaceId: principal.workspaceId, id: { in: [...new Set(page.map((row) => row.ownerId))] } }, select: { id: true, displayName: true } }) : []
    return { items: page.map((row) => ({ ...row, author: authors.find((author) => author.id === row.ownerId)?.displayName ?? 'Користувач' })), nextCursor: rows.length > 20 ? page.at(-1)!.id : null }
  }

  async detail(principal: AuthPrincipal, ticketId: string) {
    this.assertAdmin(principal)
    const ticket = await this.prisma.feedbackTicket.findFirst({ where: { id: ticketId, workspaceId: principal.workspaceId, status: 'ACTIVE' } })
    if (!ticket) throw notFound()
    const links = await this.prisma.fileLink.findMany({ where: { entityType: 'FEEDBACK_TICKET', entityId: ticketId }, orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }], select: { fileId: true } })
    const files = links.length ? await this.prisma.fileObject.findMany({ where: { workspaceId: principal.workspaceId, id: { in: links.map((link) => link.fileId) } }, select: { id: true, safeFilename: true, bytes: true, detectedMime: true, scanStatus: true } }) : []
    const author = await this.prisma.user.findFirst({ where: { id: ticket.ownerId, workspaceId: principal.workspaceId }, select: { displayName: true } })
    return { ...ticket, author: author?.displayName ?? 'Користувач', attachments: links.flatMap((link) => { const file = files.find((row) => row.id === link.fileId); return file ? [{ id: file.id, safeFilename: file.safeFilename, bytes: file.bytes, mimeType: file.detectedMime, scanStatus: file.scanStatus }] : [] }) }
  }

  async remove(principal: AuthPrincipal, ticketId: string) {
    this.assertAdmin(principal)
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.feedbackTicket.updateMany({ where: { id: ticketId, workspaceId: principal.workspaceId, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } })
      if (!result.count) throw notFound()
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'feedback.archived', entityType: 'FEEDBACK_TICKET', entityId: ticketId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { archived: true }
  }

  private assertAdmin(principal: AuthPrincipal) {
    if (principal.accountType !== 'ADMIN') throw forbidden()
  }
}
