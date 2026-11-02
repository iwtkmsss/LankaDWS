import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { CapabilitiesService } from '../authorization/capabilities.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { CalendarService } from './calendar.service.js'
import { eventAcknowledgementView, snapshotEventAcknowledgements } from './calendar-acknowledgement.js'

let prisma: PrismaClient
let directory: string
let service: CalendarService
const principal = { userId: 'recipient', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-calendar-ack-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration === 'migration_lock.toml') continue
    db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  service = new CalendarService(prisma as PrismaService, {} as CapabilitiesService, new ScopeService())
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['owner', 'recipient', 'other', 'inactive', 'outside']) {
    await prisma.user.create({ data: {
      id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
      username: userId, normalizedUsername: userId, isActive: userId !== 'inactive',
      primaryCompanyId: userId === 'outside' ? null : 'company',
    } })
  }
  await prisma.event.create({ data: {
    id: 'event', workspaceId: 'workspace', companyId: 'company', ownerId: 'owner',
    title: 'Meeting', startAt: new Date('2099-10-22T09:00:00Z'), endAt: new Date('2099-10-22T10:00:00Z'),
    sourceTimezone: 'Europe/Kyiv', requiresAcknowledgement: true,
    audiences: { create: { id: 'audience', companyId: 'company' } },
  } })
  await prisma.$transaction((tx) => snapshotEventAcknowledgements(tx, {
    id: 'event', version: 1, ownerId: 'owner', workspaceId: 'workspace',
  }, ['company']))
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('applies migrations and stores separate, idempotent receipts without acknowledging reads', async () => {
  const event = (await prisma.event.findUniqueOrThrow({ where: { id: 'event' } }))
  expect(await eventAcknowledgementView(prisma, event, 'recipient')).toEqual({
    requiredForMe: true, acknowledgedAt: null, recipientCount: 2, acknowledgedCount: 0,
  })
  const result = await service.acknowledge(principal, 'event', 1)
  expect(await service.acknowledge(principal, 'event', 1)).toEqual(result)
  expect(await eventAcknowledgementView(prisma, event, 'other')).toMatchObject({ acknowledgedAt: null, acknowledgedCount: 1 })
  expect(await prisma.auditEvent.count({ where: { action: 'calendar.event.acknowledged' } })).toBe(1)
  expect(await prisma.notification.findUnique({ where: { dedupeKey: 'calendar-ack:event:1:recipient' } })).toMatchObject({ requiresAction: false, readAt: expect.any(Date) as unknown })
})

it('rejects non-recipients, stale versions, revoked access and private events', async () => {
  await expect(service.acknowledge({ ...principal, userId: 'outside' }, 'event', 1)).rejects.toMatchObject({ status: 404 })
  await expect(service.acknowledge({ ...principal, workspaceId: 'elsewhere' }, 'event', 1)).rejects.toMatchObject({ status: 404 })
  await expect(service.acknowledge({ ...principal, allowedCompanyIds: [] }, 'event', 1)).rejects.toMatchObject({ status: 404 })
  await expect(service.acknowledge(principal, 'event', 2)).rejects.toMatchObject({ status: 409 })
  await prisma.event.update({ where: { id: 'event' }, data: { visibility: 'PRIVATE' } })
  await expect(service.acknowledge(principal, 'event', 1)).rejects.toMatchObject({ status: 404 })
  expect(await prisma.eventAcknowledgement.count({ where: { acknowledgedAt: { not: null } } })).toBe(0)
})

it('takes a fresh recipient snapshot for the revised series and leaves old receipts separate', async () => {
  await service.acknowledge(principal, 'event', 1)
  await prisma.event.update({ where: { id: 'event' }, data: { version: 2 } })
  await prisma.$transaction((tx) => snapshotEventAcknowledgements(tx, { id: 'event', version: 2, ownerId: 'owner', workspaceId: 'workspace' }, ['company']))
  const event = await prisma.event.findUniqueOrThrow({ where: { id: 'event' } })
  expect(await eventAcknowledgementView(prisma, event, 'recipient')).toMatchObject({ requiredForMe: true, acknowledgedAt: null, acknowledgedCount: 0 })
  await expect(service.acknowledge(principal, 'event', 1)).rejects.toMatchObject({ status: 409 })
})

it('restricts deletion to the owner and atomically removes receipts, audiences and live feed references', async () => {
  service = new CalendarService(prisma as PrismaService,
    { assertEnabled: vi.fn() } as unknown as CapabilitiesService, new ScopeService())
  await prisma.backgroundJob.create({ data: {
    id: 'reminder', type: 'calendar.reminder', entityType: 'EVENT', entityId: 'event',
    idempotencyKey: 'calendar-reminder:event:1', safePayload: '{}', runAt: new Date('2099-10-22T08:45:00Z'),
  } })
  await prisma.feedItem.create({ data: {
    id: 'feed', workspaceId: 'workspace', companyId: 'company', sourceType: 'EVENT', sourceId: 'event',
    sourceVersion: 1, action: 'CREATED', eventKey: 'calendar:event:1', visibility: 'COMPANY',
    safePayload: '{}', occurredAt: new Date(),
  } })
  await prisma.feedSourceHead.create({ data: {
    id: 'head', workspaceId: 'workspace', companyId: 'company', sourceType: 'EVENT', sourceId: 'event',
    itemId: 'feed', sourceVersion: 1, occurredAt: new Date(),
  } })
  const owner = { ...principal, userId: 'owner' }
  for (const caller of [principal, { ...owner, workspaceId: 'elsewhere' }, { ...owner, allowedCompanyIds: [] }]) {
    await expect(service.remove(caller, 'event', 1)).rejects.toMatchObject({ status: 404 })
  }
  await expect(service.remove(owner, 'event', 2)).rejects.toMatchObject({ status: 409 })
  expect(await prisma.eventAudience.count()).toBe(1)
  expect(await prisma.notification.count()).toBeGreaterThan(0)
  await service.remove(owner, 'event', 1)
  expect(await prisma.event.count()).toBe(0)
  expect(await prisma.eventAudience.count()).toBe(0)
  expect(await prisma.eventAcknowledgement.count()).toBe(0)
  expect(await prisma.notification.count()).toBe(0)
  expect(await prisma.feedSourceHead.count()).toBe(0)
  expect(await prisma.feedItem.count()).toBe(1)
  expect(await prisma.backgroundJob.findUnique({ where: { id: 'reminder' } })).toMatchObject({ state: 'CANCELLED' })
  expect(await prisma.auditEvent.count({ where: { action: 'calendar.event.deleted' } })).toBe(1)
  expect(await prisma.outboxEvent.count({ where: { eventType: 'calendar.event.deleted' } })).toBe(1)
})
