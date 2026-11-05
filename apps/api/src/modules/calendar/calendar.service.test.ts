import { expect, it, vi } from 'vitest'
import type { CreateCalendarEventInput } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { CapabilitiesService } from '../authorization/capabilities.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { CalendarService } from './calendar.service.js'

const principal = {
  userId: 'owner', workspaceId: 'workspace', allowedCompanyIds: ['owner-company', 'audience-company'],
} as AuthPrincipal
const input: CreateCalendarEventInput = {
  companyId: 'owner-company', title: 'Зустріч', startAt: '2026-10-20T09:00:00Z',
  endAt: '2026-10-20T10:00:00Z', sourceTimezone: 'Europe/Kyiv', allDay: false,
  audience: { type: 'COMPANIES', companyIds: ['audience-company'] },
}

function setup() {
  const createdAt = new Date('2026-10-16T10:00:00Z')
  const tx = {
    event: { create: vi.fn().mockResolvedValue({ id: 'event', version: 1, createdAt }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    eventAudience: { createMany: vi.fn(), deleteMany: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'recipient' }]) },
    eventAcknowledgement: { createMany: vi.fn() },
    notification: { createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    backgroundJob: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    idempotencyRecord: { create: vi.fn() },
    auditEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
    feedItem: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    feedSourceHead: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), deleteMany: vi.fn() },
  }
  const prisma = {
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: 'event', version: 1 }) },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<void>) => run(tx)),
  }
  const capabilities = { assertEnabled: vi.fn() }
  const service = new CalendarService(prisma as unknown as PrismaService,
    capabilities as unknown as CapabilitiesService, new ScopeService())
  return { service, prisma, tx, createdAt }
}

it('creates one canonical feed reference in the event transaction for a shared calendar event', async () => {
  const { service, tx, createdAt } = setup()
  await service.create(principal, input, 'request')
  expect(tx.feedItem.create).toHaveBeenCalledOnce()
  expect(tx.feedItem.create.mock.calls[0][0]).toMatchObject({ data: {
    sourceType: 'EVENT', sourceId: 'event', sourceVersion: 1, action: 'CREATED',
    actorId: 'owner', visibility: 'COMPANY', occurredAt: createdAt, countsAsUnread: true,
  } })
  expect(tx.feedSourceHead.upsert).toHaveBeenCalledOnce()
  expect(tx.eventAudience.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ companyId: 'audience-company' })] })
})

it('deletes only an owned workspace event at its current version and cleans live references', async () => {
  const { service, prisma, tx } = setup()
  prisma.event.findFirst.mockResolvedValue({ id: 'event', version: 1, companyId: 'owner-company' })
  await service.remove(principal, 'event', 1)
  const where = { id: 'event', workspaceId: 'workspace', ownerId: 'owner', companyId: { in: principal.allowedCompanyIds } }
  expect(prisma.event.findFirst).toHaveBeenCalledWith({ where })
  expect(tx.event.deleteMany).toHaveBeenCalledWith({ where: { ...where, version: 1 } })
  expect(tx.backgroundJob.updateMany).toHaveBeenCalledWith({
    where: { type: 'calendar.reminder', entityId: 'event', state: 'QUEUED' }, data: { state: 'CANCELLED' },
  })
  expect(tx.notification.deleteMany).toHaveBeenCalledWith({ where: { entityType: 'EVENT', entityId: 'event' } })
  expect(tx.feedSourceHead.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace', sourceType: 'EVENT', sourceId: 'event' } })
  expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'calendar.event.deleted' }) as unknown })
  expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: 'calendar.event.deleted', aggregateVersion: 2 }) as unknown })
})

it('rejects deletion of an inaccessible or foreign event before a transaction', async () => {
  const { service, prisma, tx } = setup()
  prisma.event.findFirst.mockResolvedValue(null)
  await expect(service.remove(principal, 'event', 1)).rejects.toThrow()
  expect(tx.event.deleteMany).not.toHaveBeenCalled()
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

it('rejects stale deletion before cleaning references', async () => {
  const { service, tx } = setup()
  tx.event.deleteMany.mockResolvedValue({ count: 0 })
  await expect(service.remove(principal, 'event', 1)).rejects.toMatchObject({ status: 409 })
  expect(tx.notification.deleteMany).not.toHaveBeenCalled()
  expect(tx.feedSourceHead.deleteMany).not.toHaveBeenCalled()
})

it('keeps a calendar event for only myself out of the feed', async () => {
  const { service, tx } = setup()
  await service.create(principal, { ...input, audience: { type: 'PRIVATE' } }, 'private-request')
  expect(tx.event.create).toHaveBeenCalledOnce()
  expect(tx.feedItem.create).not.toHaveBeenCalled()
  expect(tx.feedSourceHead.upsert).not.toHaveBeenCalled()
})

it('snapshots recipients and sends individual action notifications only when requested', async () => {
  const { service, tx } = setup()
  await service.create(principal, { ...input, requiresAcknowledgement: true }, 'ack')
  expect(tx.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requiresAcknowledgement: true }) as unknown })
  expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    workspaceId: 'workspace', isActive: true, id: { not: 'owner' }, primaryCompanyId: { in: ['audience-company'] },
  } }))
  expect(tx.eventAcknowledgement.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ eventId: 'event', userId: 'recipient', eventVersion: 1 })] })
  expect(tx.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ recipientId: 'recipient', entityType: 'EVENT', requiresAction: true })] })
})

it('rejects acknowledgement for private events at the service boundary', async () => {
  const { service, tx } = setup()
  await expect(service.create(principal, { ...input, audience: { type: 'PRIVATE' }, requiresAcknowledgement: true }, 'private-ack')).rejects.toThrow()
  expect(tx.event.create).not.toHaveBeenCalled()
})

it('renews acknowledgements on edits and disables them when the event becomes private', async () => {
  const { service, tx, prisma } = setup()
  prisma.event.findFirst.mockResolvedValue({
    id: 'event', version: 1, companyId: 'owner-company', ownerId: 'owner', requiresAcknowledgement: true,
  })
  await service.update(principal, 'event', { ...input, expectedVersion: 1 })
  expect(tx.event.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ requiresAcknowledgement: true }) as unknown }))
  expect(tx.eventAcknowledgement.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ eventId: 'event', userId: 'recipient', eventVersion: 2 })] })
  tx.eventAcknowledgement.createMany.mockClear()
  await service.update(principal, 'event', { ...input, expectedVersion: 1, audience: { type: 'PRIVATE' } })
  expect(tx.event.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ requiresAcknowledgement: false }) as unknown }))
  expect(tx.eventAcknowledgement.createMany).not.toHaveBeenCalled()
})

it('returns an idempotent replay without creating another event or feed item', async () => {
  const { service, prisma, tx } = setup()
  await service.create(principal, input, 'request')
  const record = tx.idempotencyRecord.create.mock.calls[0][0] as { data: { requestFingerprint: string } }
  prisma.idempotencyRecord.findUnique.mockResolvedValue({ resultId: 'event', requestFingerprint: record.data.requestFingerprint })
  await expect(service.create(principal, input, 'request')).resolves.toEqual({ id: 'event', version: 1 })
  expect(prisma.$transaction).toHaveBeenCalledOnce()
  expect(tx.feedItem.create).toHaveBeenCalledOnce()
})

it('creates a durable reminder addressed implicitly to the private event owner', async () => {
  const { service, tx } = setup()
  await service.create(principal, { ...input, startAt: '2099-10-20T09:00:00Z', endAt: '2099-10-20T10:00:00Z', audience: { type: 'PRIVATE' }, reminderMinutes: 15 }, 'reminder')
  expect(tx.backgroundJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    type: 'calendar.reminder', entityType: 'EVENT', runAt: new Date('2099-10-20T08:45:00Z'),
    safePayload: expect.stringContaining('"minutes":15') as unknown,
  }) as unknown })
  expect(tx.feedItem.create).not.toHaveBeenCalled()
})

it('rejects reminders for a company event even when called without the controller', async () => {
  const { service, tx } = setup()
  await expect(service.create(principal, { ...input, reminderMinutes: 0 }, 'company-reminder')).rejects.toThrow()
  expect(tx.event.create).not.toHaveBeenCalled()
})

it('reschedules a private reminder on edits and cancels it on switching to company visibility', async () => {
  const { service, tx, prisma } = setup()
  prisma.event.findFirst.mockResolvedValue({ id: 'event', version: 1, companyId: 'owner-company', recurrenceJson: null })
  const update = { ...input, startAt: '2099-10-20T09:00:00Z', endAt: '2099-10-20T10:00:00Z', expectedVersion: 1, reminderMinutes: 30 as const }
  await service.update(principal, 'event', { ...update, audience: { type: 'PRIVATE' } })
  expect(tx.backgroundJob.updateMany).toHaveBeenCalledWith({ where: { type: 'calendar.reminder', entityId: 'event', state: 'QUEUED' }, data: { state: 'CANCELLED' } })
  expect(tx.backgroundJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    idempotencyKey: 'calendar-reminder:event:2', runAt: new Date('2099-10-20T08:30:00Z'),
  }) as unknown })
  tx.backgroundJob.create.mockClear()
  await service.update(principal, 'event', { ...update, reminderMinutes: null })
  expect(tx.backgroundJob.create).not.toHaveBeenCalled()
})
