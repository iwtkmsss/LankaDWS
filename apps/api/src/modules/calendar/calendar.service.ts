import { Injectable } from '@nestjs/common'
import {
  OrganizationCapability,
  type ConvertChatMessageToEventInput,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from '@bert-crm/contracts'
import { fingerprint, id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CapabilitiesService } from '../authorization/capabilities.service.js'

const createFromMessageOperation = 'calendar.event.create-from-message'
const createOperation = 'calendar.event.create'

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilitiesService,
  ) {}

  async create(
    principal: AuthPrincipal,
    input: CreateCalendarEventInput,
    idempotencyKey: string,
  ): Promise<{ id: string; version: number }> {
    await this.capabilities.assertEnabled(
      principal,
      input.companyId,
      OrganizationCapability.CalendarWrite,
    )
    return this.persistEvent(
      principal,
      input.companyId,
      input,
      idempotencyKey,
      createOperation,
    )
  }

  async update(
    principal: AuthPrincipal,
    eventId: string,
    input: UpdateCalendarEventInput,
  ): Promise<{ id: string; version: number }> {
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
        ownerId: principal.userId,
      },
    })
    if (!event) throw notFound()
    await this.capabilities.assertEnabled(
      principal,
      event.companyId,
      OrganizationCapability.CalendarWrite,
    )
    this.assertTimezone(input.sourceTimezone)
    const nextVersion = input.expectedVersion + 1
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.event.updateMany({
        where: {
          id: event.id,
          ownerId: principal.userId,
          version: input.expectedVersion,
        },
        data: {
          title: input.title,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          sourceTimezone: input.sourceTimezone,
          allDay: input.allDay,
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw conflict('Подія вже змінилася. Оновіть календар.')
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: event.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'calendar.event.updated',
          entityType: 'EVENT',
          entityId: event.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'EVENT',
          aggregateId: event.id,
          aggregateVersion: nextVersion,
          eventType: 'calendar.event.updated',
          safePayload: JSON.stringify({ eventId: event.id, companyId: event.companyId }),
        },
      })
    })
    return { id: event.id, version: nextVersion }
  }

  async createFromMessage(
    principal: AuthPrincipal,
    messageId: string,
    input: ConvertChatMessageToEventInput,
    idempotencyKey: string,
  ): Promise<{ id: string; version: number }> {
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
        thread: {
          select: {
            companyId: true,
          },
        },
      },
    })
    if (!message?.thread.companyId) throw notFound()

    const companyId = message.thread.companyId
    await this.capabilities.assertEnabled(
      principal,
      companyId,
      OrganizationCapability.CalendarWrite,
    )
    return this.persistEvent(
      principal,
      companyId,
      input,
      idempotencyKey,
      createFromMessageOperation,
      message.id,
    )
  }

  private async persistEvent(
    principal: AuthPrincipal,
    companyId: string,
    input: ConvertChatMessageToEventInput,
    idempotencyKey: string,
    operation: string,
    messageId?: string,
  ): Promise<{ id: string; version: number }> {
    this.assertTimezone(input.sourceTimezone)
    const requestFingerprint = fingerprint(JSON.stringify({
      companyId,
      messageId: messageId ?? null,
      ...input,
    }), operation)
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation,
        },
      },
    })
    if (existing && existing.requestFingerprint !== requestFingerprint) {
      throw conflict('Цей ключ повтору вже використано для іншого запиту.')
    }
    if (existing?.resultId) {
      const event = await this.prisma.event.findFirst({
        where: {
          id: existing.resultId,
          workspaceId: principal.workspaceId,
          companyId,
          ownerId: principal.userId,
        },
        select: { id: true, version: true },
      })
      if (!event) throw conflict('Результат попереднього запиту більше не доступний.')
      return event
    }

    const eventId = id('evt')
    const startAt = new Date(input.startAt)
    const endAt = new Date(input.endAt)
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          id: eventId,
          workspaceId: principal.workspaceId,
          companyId,
          ownerId: principal.userId,
          title: input.title,
          startAt,
          endAt,
          sourceTimezone: input.sourceTimezone,
          allDay: input.allDay,
          visibility: 'INTERNAL',
        },
      })
      if (messageId) {
        await tx.entityLink.create({
          data: {
            id: id('lnk'),
            sourceType: 'EVENT',
            sourceId: eventId,
            targetType: 'MESSAGE',
            targetId: messageId,
            relation: 'RELATED',
            createdBy: principal.userId,
          },
        })
      }
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'EVENT',
          resultId: eventId,
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
          action: messageId
            ? 'calendar.event.created-from-message'
            : 'calendar.event.created',
          entityType: 'EVENT',
          entityId: eventId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ source: messageId ? 'MESSAGE' : 'CALENDAR' }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'EVENT',
          aggregateId: eventId,
          aggregateVersion: event.version,
          eventType: 'calendar.event.created',
          safePayload: JSON.stringify({ eventId, companyId }),
        },
      })
    })
    return { id: eventId, version: 1 }
  }

  private assertTimezone(value: string): void {
    try {
      new Intl.DateTimeFormat('uk-UA', { timeZone: value }).format()
    } catch {
      throw badRequest('calendar_timezone_invalid')
    }
  }
}
