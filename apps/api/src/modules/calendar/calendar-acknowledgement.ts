import type { CalendarAcknowledgementView } from '@lankadws/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import { id } from '../../common/crypto.js'

// Snapshot recipients for this revision, just as authored feed posts do.
// Reading an event never records acknowledgement.
export async function snapshotEventAcknowledgements(
  tx: Prisma.TransactionClient,
  event: { id: string; version: number; ownerId: string; workspaceId: string },
  companyIds: string[],
): Promise<void> {
  const users = await tx.user.findMany({
    where: { workspaceId: event.workspaceId, isActive: true, id: { not: event.ownerId }, primaryCompanyId: { in: companyIds } },
    select: { id: true },
  })
  if (users.length === 0) return
  await tx.eventAcknowledgement.createMany({ data: users.map((user) => ({
    id: id('evack'), eventId: event.id, userId: user.id, eventVersion: event.version,
  })) })
  await tx.notification.createMany({ data: users.map((user) => ({
    id: id('ntf'), recipientId: user.id, category: 'CALENDAR',
    safeTitle: 'Потрібне підтвердження події',
    safeSnippet: 'Відкрийте подію та підтвердьте ознайомлення окремою дією.',
    entityType: 'EVENT', entityId: event.id, requiresAction: true, deliveredAt: new Date(),
    dedupeKey: `calendar-ack:${event.id}:${event.version}:${user.id}`,
  })) })
}

export async function eventAcknowledgementView(
  db: Pick<Prisma.TransactionClient, 'eventAcknowledgement'>,
  event: { id: string; version: number; requiresAcknowledgement: boolean },
  userId: string,
): Promise<CalendarAcknowledgementView | null> {
  if (!event.requiresAcknowledgement) return null
  const where = { eventId: event.id, eventVersion: event.version }
  const [recipientCount, acknowledgedCount, mine] = await Promise.all([
    db.eventAcknowledgement.count({ where }),
    db.eventAcknowledgement.count({ where: { ...where, acknowledgedAt: { not: null } } }),
    db.eventAcknowledgement.findUnique({ where: { eventId_userId_eventVersion: { ...where, userId } } }),
  ])
  return { recipientCount, acknowledgedCount, requiredForMe: Boolean(mine), acknowledgedAt: mine?.acknowledgedAt?.toISOString() ?? null }
}
