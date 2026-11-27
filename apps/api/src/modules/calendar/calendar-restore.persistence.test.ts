import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import type { CapabilitiesService } from '../authorization/capabilities.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { CalendarService } from './calendar.service.js'
import { CalendarController } from './calendar.controller.js'
import { snapshotEventAcknowledgements } from './calendar-acknowledgement.js'
import { writeFeedProjection } from '../feed/feed-projection.service.js'

let prisma: PrismaClient
let directory: string
let service: CalendarService
let controller: CalendarController
const base = { workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal
const owner = { ...base, userId: 'owner' }
const recipient = { ...base, userId: 'recipient' }
const admin = { ...base, userId: 'admin', accountType: 'ADMIN' as const }
const range = ['company', '2099-10-01T00:00:00Z', '2099-11-01T00:00:00Z'] as const

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-calendar-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration === 'migration_lock.toml') continue
    db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  service = new CalendarService(prisma as PrismaService,
    { assertEnabled: vi.fn() } as unknown as CapabilitiesService, new ScopeService())
  controller = new CalendarController(prisma as PrismaService, new ScopeService(), service)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['owner', 'recipient', 'other', 'admin']) {
    await prisma.user.create({ data: {
      id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
      username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
      accountType: userId === 'admin' ? 'ADMIN' : 'USER',
    } })
  }
  const event = await prisma.event.create({ data: {
    id: 'event', workspaceId: 'workspace', companyId: 'company', ownerId: 'owner',
    title: 'Meeting', startAt: new Date('2099-10-22T09:00:00Z'), endAt: new Date('2099-10-22T10:00:00Z'),
    sourceTimezone: 'Europe/Kyiv', requiresAcknowledgement: true,
    audiences: { create: { id: 'audience', companyId: 'company' } },
  } })
  await prisma.$transaction(async (tx) => {
    await snapshotEventAcknowledgements(tx, { id: 'event', version: 1, ownerId: 'owner', workspaceId: 'workspace' }, ['company'])
    await writeFeedProjection(tx, {
      workspaceId: 'workspace', companyId: 'company', sourceType: 'EVENT', sourceId: 'event', sourceVersion: 1,
      action: 'CREATED', actorId: 'owner', recipientIds: [], visibility: 'COMPANY', occurredAt: event.createdAt,
    })
  })
})

afterEach(async () => {
  vi.useRealTimers()
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

const listedIds = async (reader: AuthPrincipal) =>
  (await controller.events({ principal: reader } as LankaDWSRequest, ...range)).items.map((item) => item.id)

it('lets the actor undo within 10 minutes and rebuilds the feed head and acknowledgement requests', async () => {
  await service.acknowledge(recipient, 'event', 1)
  await service.remove(owner, 'event', 1)
  expect(await prisma.feedSourceHead.count()).toBe(0)
  await expect(service.restore(owner, 'event', 1)).rejects.toMatchObject({ status: 409 })
  expect(await service.restore(owner, 'event', 2)).toEqual({ id: 'event', version: 3 })
  expect(await prisma.event.findUniqueOrThrow({ where: { id: 'event' } })).toMatchObject({ deletedAt: null, deletedById: null, version: 3 })
  expect(await listedIds(recipient)).toEqual(['event'])
  const head = await prisma.feedSourceHead.findFirstOrThrow({ where: { sourceType: 'EVENT', sourceId: 'event' }, include: { item: true } })
  expect(head).toMatchObject({ sourceVersion: 3, item: { action: 'RESTORED' } })
  // Acknowledgement is requested again only from people who had not acknowledged the unchanged content.
  expect(await prisma.eventAcknowledgement.findMany({ where: { eventVersion: 3 }, orderBy: { userId: 'asc' }, select: { userId: true, acknowledgedAt: true } }))
    .toEqual([
      { userId: 'admin', acknowledgedAt: null },
      { userId: 'other', acknowledgedAt: null },
      { userId: 'recipient', acknowledgedAt: expect.any(Date) as unknown },
    ])
  expect(await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: 'calendar-ack:event:3:other' } })).toMatchObject({ requiresAction: true })
  expect(await prisma.notification.findUnique({ where: { dedupeKey: 'calendar-ack:event:3:recipient' } })).toBeNull()
  expect(await prisma.auditEvent.count({ where: { action: 'calendar.event.restored' } })).toBe(1)
  expect(await prisma.outboxEvent.count({ where: { eventType: 'calendar.event.restored' } })).toBe(1)
  await expect(service.restore(owner, 'event', 3)).rejects.toMatchObject({ status: 404 })
})

it('refuses the actor after 10 minutes and other users, while an administrator may always restore', async () => {
  await service.remove(owner, 'event', 1)
  await expect(service.restore(recipient, 'event', 2)).rejects.toMatchObject({ status: 404 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + ACTOR_RESTORE_WINDOW_MS + 1_000)
  await expect(service.restore(owner, 'event', 2)).rejects.toMatchObject({ status: 403 })
  await expect(service.restore(admin, 'event', 1)).rejects.toMatchObject({ status: 409 })
  expect(await service.restore(admin, 'event', 2)).toEqual({ id: 'event', version: 3 })
  expect(await listedIds(owner)).toEqual(['event'])
})

it('shows hidden events only to an administrator in the opt-in deleted view', async () => {
  const request = (reader: AuthPrincipal) => ({ principal: reader } as LankaDWSRequest)
  await expect(controller.events(request(owner), ...range, 'ALL', '1')).rejects.toMatchObject({ status: 403 })
  expect((await controller.events(request(admin), ...range, 'ALL', '1')).items).toEqual([])
  await service.remove(owner, 'event', 1)
  expect(await listedIds(admin)).toEqual([])
  const deleted = await controller.events(request(admin), ...range, 'ALL', '1')
  expect(deleted.items).toEqual([expect.objectContaining({
    id: 'event', version: 2, ownerName: 'owner',
    hidden: { hiddenAt: expect.any(String) as unknown, hiddenBy: { id: 'owner', displayName: 'owner' } },
  })])
  expect(deleted.items[0]).not.toHaveProperty('deletedAt')
})

it('re-schedules the reminder of a restored private event', async () => {
  await prisma.event.update({ where: { id: 'event' }, data: { visibility: 'PRIVATE', requiresAcknowledgement: false } })
  await prisma.backgroundJob.create({ data: {
    id: 'reminder', type: 'calendar.reminder', entityType: 'EVENT', entityId: 'event',
    idempotencyKey: 'calendar-reminder:event:1', safePayload: JSON.stringify({ minutes: 15, version: 1, occurrenceAt: '2099-10-22T09:00:00.000Z' }),
    runAt: new Date('2099-10-22T08:45:00Z'),
  } })
  await service.remove(owner, 'event', 1)
  await service.restore(owner, 'event', 2)
  expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: 'calendar-reminder:event:3' } }))
    .toMatchObject({ state: 'QUEUED', runAt: new Date('2099-10-22T08:45:00Z') })
  expect(await prisma.feedSourceHead.count({ where: { sourceType: 'EVENT', sourceId: 'event' } })).toBe(0)
})
