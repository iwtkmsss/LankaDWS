import { id } from '../../common/crypto.js'
import { badRequest } from '../../common/errors.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { calendarOccurrences, readCalendarRecurrence } from './calendar-recurrence.js'

type ReminderEvent = {
  id: string; version: number; startAt: Date; endAt: Date; sourceTimezone: string; recurrenceJson: string | null
}

export const reminderJobKey = (eventId: string, version: number) => `calendar-reminder:${eventId}:${version}`

export async function readReminderMinutes(tx: Pick<Prisma.TransactionClient, 'backgroundJob'>, eventId: string, version: number): Promise<number | null> {
  const job = await tx.backgroundJob.findUnique({ where: { idempotencyKey: reminderJobKey(eventId, version) } })
  return job ? (JSON.parse(job.safePayload) as { minutes: number }).minutes : null
}

function nextOccurrence(event: ReminderEvent, minutes: number, after: Date) {
  const from = new Date(after.getTime() + minutes * 60_000)
  const recurrence = readCalendarRecurrence(event.recurrenceJson)
  const days = recurrence ? recurrence.interval * (recurrence.frequency === 'MONTHLY' ? 32 : recurrence.frequency === 'WEEKLY' ? 7 : 1) + 2 : 1
  const to = new Date(Math.max(from.getTime(), event.startAt.getTime()) + days * 86_400_000)
  return calendarOccurrences(event, from, to).find((occurrence) => occurrence.startAt >= from)
}

// The versioned durable job also retains the selected reminder after delivery.
export async function scheduleCalendarReminder(tx: Prisma.TransactionClient, event: ReminderEvent, minutes: number | null, now = new Date(), allowElapsed = false) {
  if (minutes === null) return
  const occurrence = nextOccurrence(event, minutes, now)
  if (!occurrence && !allowElapsed) throw badRequest('calendar_reminder_time')
  await tx.backgroundJob.create({ data: {
    id: id('job'), type: 'calendar.reminder', entityType: 'EVENT', entityId: event.id,
    idempotencyKey: reminderJobKey(event.id, event.version),
    safePayload: JSON.stringify({ minutes, version: event.version, occurrenceAt: (occurrence?.startAt ?? event.startAt).toISOString() }),
    state: occurrence ? 'QUEUED' : 'SUCCEEDED',
    runAt: new Date((occurrence?.startAt ?? event.startAt).getTime() - minutes * 60_000),
  } })
}

export async function deliverCalendarReminder(prisma: PrismaService, eventId: string, payload: Record<string, unknown>): Promise<string | null> {
  const { minutes, version, occurrenceAt } = payload
  if (typeof minutes !== 'number' || typeof version !== 'number' || typeof occurrenceAt !== 'string') return null
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, version, visibility: 'PRIVATE' } })
    if (!event) return null
    const owner = await tx.user.findFirst({ where: { id: event.ownerId, workspaceId: event.workspaceId, isActive: true } })
    if (!owner) return null
    const company = await tx.company.findFirst({ where: { id: event.companyId, workspaceId: event.workspaceId, isActive: true }, select: { id: true } })
    if (!company) return null
    const dedupeKey = `${reminderJobKey(event.id, version)}:${occurrenceAt}`
    await tx.notification.upsert({ where: { dedupeKey }, create: {
      id: id('ntf'), recipientId: event.ownerId, category: 'CALENDAR',
      safeTitle: 'Нагадування про подію', safeSnippet: event.title.slice(0, 180),
      entityType: 'EVENT', entityId: event.id, requiresAction: true, deliveredAt: new Date(), dedupeKey,
    }, update: {} })
    const next = event.recurrenceJson ? nextOccurrence(event, minutes, new Date(Math.max(Date.now(), Date.parse(occurrenceAt) - minutes * 60_000) + 1)) : null
    if (next) {
      const key = `${reminderJobKey(event.id, version)}:${next.startAt.toISOString()}`
      await tx.backgroundJob.upsert({ where: { idempotencyKey: key }, create: {
        id: id('job'), type: 'calendar.reminder', entityType: 'EVENT', entityId: event.id,
        idempotencyKey: key, safePayload: JSON.stringify({ minutes, version, occurrenceAt: next.startAt.toISOString() }),
        runAt: new Date(next.startAt.getTime() - minutes * 60_000),
      }, update: {} })
    }
    return event.ownerId
  })
}
