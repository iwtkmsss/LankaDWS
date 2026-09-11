import { Injectable } from '@nestjs/common'
import {
  OrganizationCapability,
  type CalendarEventAudienceInput,
  type ConvertChatMessageToEventInput,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from '@lankadws/contracts'
import { fingerprint, id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CapabilitiesService } from '../authorization/capabilities.service.js'
import { ScopeService } from '../authorization/scope.service.js'

const createFromMessageOperation = 'calendar.event.create-from-message'
const createOperation = 'calendar.event.create'

// A private event keeps its owner company row for persistence and relies on
// PRIVATE visibility to stay out of every shared calendar.
const privateVisibility = 'PRIVATE'
const sharedVisibility = 'INTERNAL'

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilitiesService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Every active company in the principal's workspace can be an event audience.
   * Creating the event itself still requires CALENDAR_WRITE for its owner row.
   */
  async audiences(
    principal: AuthPrincipal,
    company?: string,
  ): Promise<{ items: Array<{ companyId: string; label: string }>; ownerCompanyId: string | null }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const writableCompanyIds = await this.capabilities.effectiveOrganizationIds(
      principal,
      company,
      OrganizationCapability.CalendarWrite,
    )
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds }, workspaceId: principal.workspaceId, isActive: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    })
    const availableIds = new Set(companies.map((company) => company.id))
    return {
      items: companies.map((item) => ({ companyId: item.id, label: item.displayName })),
      ownerCompanyId: writableCompanyIds.find((companyId) => availableIds.has(companyId)) ?? null,
    }
  }

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
    const audienceCompanyIds = this.resolveAudience(
      principal,
      input.companyId,
      input.audience,
    )
    return this.persistEvent(
      principal,
      input.companyId,
      input,
      audienceCompanyIds,
      input.audience.type === 'PRIVATE',
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
    const isPrivate = input.audience.type === 'PRIVATE'
    const audienceCompanyIds = this.resolveAudience(
      principal,
      event.companyId,
      input.audience,
    )
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
          description: input.description?.trim() || null,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          sourceTimezone: input.sourceTimezone,
          allDay: input.allDay,
          visibility: isPrivate ? privateVisibility : sharedVisibility,
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw conflict('Подія вже змінилася. Оновіть календар.')
      }
      await tx.eventAudience.deleteMany({ where: { eventId: event.id } })
      await tx.eventAudience.createMany({
        data: audienceCompanyIds.map((companyId) => ({
          id: id('evta'),
          eventId: event.id,
          companyId,
        })),
      })
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
      [companyId],
      false,
      idempotencyKey,
      createFromMessageOperation,
      message.id,
    )
  }

  /**
   * Every audience company must be in the principal's workspace scope.
   */
  private resolveAudience(
    principal: AuthPrincipal,
    companyId: string,
    audience: CalendarEventAudienceInput,
  ): string[] {
    if (audience.type === 'PRIVATE') return [companyId]
    const allowed = this.scope.allowedCompanies(principal)
    const requested = [...new Set(audience.companyIds)]
    if (requested.some((item) => !allowed.includes(item))) throw badRequest('calendar_audience_invalid')
    return requested
  }

  private async persistEvent(
    principal: AuthPrincipal,
    companyId: string,
    input: ConvertChatMessageToEventInput,
    audienceCompanyIds: string[],
    isPrivate: boolean,
    idempotencyKey: string,
    operation: string,
    messageId?: string,
  ): Promise<{ id: string; version: number }> {
    this.assertTimezone(input.sourceTimezone)
    const requestFingerprint = fingerprint(JSON.stringify({
      companyId,
      messageId: messageId ?? null,
      audienceCompanyIds: [...audienceCompanyIds].sort(),
      isPrivate,
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
          description: input.description?.trim() || null,
          startAt,
          endAt,
          sourceTimezone: input.sourceTimezone,
          allDay: input.allDay,
          visibility: isPrivate ? privateVisibility : sharedVisibility,
        },
      })
      await tx.eventAudience.createMany({
        data: audienceCompanyIds.map((audienceCompanyId) => ({
          id: id('evta'),
          eventId,
          companyId: audienceCompanyId,
        })),
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
