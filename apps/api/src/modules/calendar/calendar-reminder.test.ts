import { afterEach, expect, it, vi } from 'vitest'
import { createCalendarEventSchema, updateCalendarEventSchema } from '@lankadws/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { deliverCalendarReminder, readReminderMinutes, scheduleCalendarReminder } from './calendar-reminder.js'

const event = { id: 'event', version: 2, ownerId: 'owner', workspaceId: 'workspace', visibility: 'PRIVATE',
  title: 'Особиста зустріч', startAt: new Date('2026-10-24T06:00:00Z'), endAt: new Date('2026-10-24T07:00:00Z'),
  sourceTimezone: 'Europe/Kyiv', recurrenceJson: null as string | null }
const payload = { minutes: 15, version: 2, occurrenceAt: event.startAt.toISOString() }
afterEach(() => vi.useRealTimers())

function setup() {
  const tx = {
    event: { findFirst: vi.fn().mockResolvedValue(event) }, user: { findFirst: vi.fn().mockResolvedValue({ id: 'owner' }) },
    company: { findFirst: vi.fn().mockResolvedValue({ id: 'company' }) },
    notification: { upsert: vi.fn() }, backgroundJob: { create: vi.fn(), upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
  }
  const prisma = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaService
  return { tx, client: tx as unknown as Prisma.TransactionClient, prisma }
}

it('schedules and retains a zero-minute reminder', async () => {
  const { tx, client } = setup()
  await scheduleCalendarReminder(client, event, 0, new Date('2026-10-23T00:00:00Z'))
  expect(tx.backgroundJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runAt: event.startAt, state: 'QUEUED' }) as unknown })
  tx.backgroundJob.findUnique.mockResolvedValue({ safePayload: JSON.stringify({ minutes: 0 }) })
  expect(await readReminderMinutes(client, event.id, event.version)).toBe(0)
})

it('rejects an elapsed reminder when creating and retains it without redelivery when editing', async () => {
  const { tx, client } = setup()
  const now = new Date('2026-10-25T00:00:00Z')
  await expect(scheduleCalendarReminder(client, event, 15, now)).rejects.toThrow()
  await scheduleCalendarReminder(client, event, 15, now, true)
  expect(tx.backgroundJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ state: 'SUCCEEDED' }) as unknown })
})

it('delivers only one idempotent in-app notification to the owner', async () => {
  const { tx, prisma } = setup()
  expect(await deliverCalendarReminder(prisma, event.id, payload)).toBe('owner')
  expect(tx.event.findFirst).toHaveBeenCalledWith({ where: { id: event.id, version: 2, visibility: 'PRIVATE' } })
  expect(tx.notification.upsert).toHaveBeenCalledWith({ where: { dedupeKey: expect.any(String) as unknown }, create: expect.objectContaining({
    recipientId: 'owner', category: 'CALENDAR', entityType: 'EVENT', entityId: 'event', safeSnippet: event.title,
  }) as unknown, update: {} })
  expect(tx.backgroundJob.upsert).not.toHaveBeenCalled()
})

it('ignores deleted, shared or changed events and inactive owners', async () => {
  const { tx, prisma } = setup()
  tx.event.findFirst.mockResolvedValueOnce(null)
  expect(await deliverCalendarReminder(prisma, event.id, payload)).toBeNull()
  tx.user.findFirst.mockResolvedValueOnce(null)
  expect(await deliverCalendarReminder(prisma, event.id, payload)).toBeNull()
  tx.company.findFirst.mockResolvedValueOnce(null)
  expect(await deliverCalendarReminder(prisma, event.id, payload)).toBeNull()
  expect(tx.notification.upsert).not.toHaveBeenCalled()
})

it('chains recurring reminders across DST with the same local start time', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-24T05:45:00Z'))
  const { tx, prisma } = setup()
  tx.event.findFirst.mockResolvedValue({ ...event, recurrenceJson: JSON.stringify({ frequency: 'DAILY', interval: 1, until: null }) })
  await deliverCalendarReminder(prisma, event.id, payload)
  expect(tx.backgroundJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
    runAt: new Date('2026-10-25T06:45:00Z'), safePayload: JSON.stringify({ minutes: 15, version: 2, occurrenceAt: '2026-10-25T07:00:00.000Z' }),
  }) as unknown }))
})

it('stops recurrence at its end and skips missed occurrences after downtime', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'))
  const { tx, prisma } = setup()
  tx.event.findFirst.mockResolvedValue({ ...event, recurrenceJson: JSON.stringify({ frequency: 'DAILY', interval: 1, until: '2026-10-26T23:59:59Z' }) })
  await deliverCalendarReminder(prisma, event.id, payload)
  expect(tx.backgroundJob.upsert).not.toHaveBeenCalled()
  tx.event.findFirst.mockResolvedValue({ ...event, recurrenceJson: JSON.stringify({ frequency: 'DAILY', interval: 1, until: null }) })
  await deliverCalendarReminder(prisma, event.id, payload)
  expect(tx.backgroundJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ runAt: new Date('2026-11-02T06:45:00Z') }) as unknown }))
})

it.each([createCalendarEventSchema, updateCalendarEventSchema])('rejects company reminders and invalid offsets in the request contract', (schema) => {
  const input = { companyId: 'company', expectedVersion: 2, title: event.title, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(), audience: { type: 'COMPANIES', companyIds: ['company'] }, reminderMinutes: 15 }
  expect(schema.safeParse(input).success).toBe(false)
  expect(schema.safeParse({ ...input, reminderMinutes: null }).success).toBe(true)
  expect(schema.safeParse({ ...input, audience: { type: 'PRIVATE' }, reminderMinutes: 0 }).success).toBe(true)
  expect(schema.safeParse({ ...input, audience: { type: 'PRIVATE' }, reminderMinutes: -1 }).success).toBe(false)
})
