import { recordAudit } from '../../common/audit.js'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { Prisma } from '../../generated/prisma/client.js'
import type { ChatRealtimeService } from '../communication/chat-realtime.service.js'

// Every department owns one group chat for its members (docs/decisions.md
// 2026-11-12). It is an ordinary GROUP `MessageThread` linked through
// `entityType`/`entityId`; the deterministic id keeps it unique per unit.
export const ORG_UNIT_THREAD_ENTITY = 'ORG_UNIT'
export const orgUnitThreadId = (unitId: string) => `thr_${unitId}`

type Tx = Prisma.TransactionClient
export type OrgUnitChatUnit = { id: string; workspaceId: string; companyId: string; name: string; managerId: string | null }
/** Realtime work to publish once the surrounding transaction has committed. */
export type OrgUnitChatEvents = { threadIds: string[]; messages: Array<{ threadId: string; messageId: string }> }

export const noOrgUnitChatEvents = (): OrgUnitChatEvents => ({ threadIds: [], messages: [] })

export function mergeOrgUnitChatEvents(...events: OrgUnitChatEvents[]): OrgUnitChatEvents {
  return {
    threadIds: [...new Set(events.flatMap((event) => event.threadIds))],
    messages: events.flatMap((event) => event.messages),
  }
}

export function publishOrgUnitChatEvents(realtime: ChatRealtimeService, events: OrgUnitChatEvents) {
  for (const threadId of events.threadIds) void realtime.publish(threadId, 'participant.updated').catch(() => undefined)
  for (const message of events.messages) void realtime.publish(message.threadId, 'message.created', message.messageId).catch(() => undefined)
}

/**
 * Returns the unit's chat, creating it when missing. A chat created for a unit
 * that already has people (units older than this feature) starts with its
 * current members; `excludeUserIds` are left for the caller to add with an
 * announcement.
 */
export async function ensureOrgUnitThread(tx: Tx, principal: AuthPrincipal, unit: OrgUnitChatUnit, excludeUserIds: string[] = []): Promise<string> {
  const threadId = orgUnitThreadId(unit.id)
  const existing = await tx.messageThread.findUnique({ where: { id: threadId }, select: { id: true } })
  if (existing) return threadId
  const members = await tx.user.findMany({
    where: {
      workspaceId: unit.workspaceId, isActive: true, accountType: 'USER', primaryCompanyId: unit.companyId,
      id: { notIn: excludeUserIds },
      OR: [
        { orgAssignments: { some: { orgUnitId: unit.id, companyId: unit.companyId, endedAt: null, isPrimary: true } } },
        ...(unit.managerId ? [{ id: unit.managerId }] : []),
      ],
    },
    select: { id: true },
  })
  const thread = await tx.messageThread.create({ data: {
    id: threadId, workspaceId: unit.workspaceId, companyId: unit.companyId, kind: 'GROUP', title: unit.name.slice(0, 120),
    entityType: ORG_UNIT_THREAD_ENTITY, entityId: unit.id, createdById: principal.userId,
  } })
  if (members.length) {
    await tx.threadParticipant.createMany({ data: members.map((member) => ({
      id: id('tpart'), threadId, userId: member.id, role: member.id === unit.managerId ? 'OWNER' : 'MEMBER',
    })) })
  }
  await recordAudit(tx, principal, { companyId: unit.companyId, action: 'message.thread_created', entityType: 'MESSAGE_THREAD', entityId: threadId, safeDiff: { kind: 'GROUP', orgUnitId: unit.id, participantCount: members.length } })
  await tx.outboxEvent.create({ data: {
    id: id('out'), aggregateType: 'MESSAGE_THREAD', aggregateId: threadId, aggregateVersion: thread.version,
    eventType: 'message.thread_created', safePayload: JSON.stringify({ threadId, companyId: unit.companyId, kind: 'GROUP' }),
  } })
  return threadId
}

/**
 * Adds people who joined the unit to its chat and announces each of them
 * there. People who already participate are skipped, so repeating the call is
 * safe. The announcement is authored by the acting administrator.
 */
export async function addOrgUnitThreadMembers(tx: Tx, principal: AuthPrincipal, unit: OrgUnitChatUnit, userIds: string[]): Promise<OrgUnitChatEvents> {
  if (!userIds.length) return noOrgUnitChatEvents()
  const threadId = await ensureOrgUnitThread(tx, principal, unit, userIds)
  const participants = await tx.threadParticipant.findMany({ where: { threadId, userId: { in: userIds } }, select: { id: true, userId: true, leftAt: true } })
  const priorByUserId = new Map(participants.map((participant) => [participant.userId, participant]))
  const joined = await tx.user.findMany({
    where: { id: { in: userIds.filter((userId) => priorByUserId.get(userId)?.leftAt !== null) }, workspaceId: unit.workspaceId },
    select: { id: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  })
  if (!joined.length) return noOrgUnitChatEvents()
  const now = new Date()
  const messages: OrgUnitChatEvents['messages'] = []
  const aggregate = await tx.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: now, version: { increment: 1 } }, select: { version: true } })
  for (const user of joined) {
    const prior = priorByUserId.get(user.id)
    const role = user.id === unit.managerId ? 'OWNER' : 'MEMBER'
    if (prior) {
      await tx.threadParticipant.update({ where: { id: prior.id }, data: { role, leftAt: null, joinedAt: now, notificationMode: 'ALL', version: { increment: 1 } } })
    } else {
      await tx.threadParticipant.create({ data: { id: id('tpart'), threadId, userId: user.id, role, joinedAt: now } })
    }
    const messageId = id('msg')
    await tx.message.create({ data: {
      id: messageId, threadId, authorId: principal.userId, createdAt: now,
      body: `До підрозділу «${unit.name}» додано нового учасника: ${user.displayName}.`,
    } })
    messages.push({ threadId, messageId })
    const dedupeKey = `org-unit-chat-joined:${threadId}:${user.id}:v${aggregate.version}`
    await tx.notification.upsert({
      where: { dedupeKey },
      create: {
        id: id('ntf'), recipientId: user.id, category: 'CHAT', safeTitle: 'Вас додано до чату підрозділу',
        safeSnippet: 'Відкрийте чат підрозділу, щоб познайомитися з командою.',
        entityType: 'MESSAGE_THREAD', entityId: threadId, requiresAction: false, deliveredAt: now, dedupeKey,
      },
      update: {},
    })
  }
  await recordAudit(tx, principal, { companyId: unit.companyId, action: 'message.participant_added', entityType: 'MESSAGE_THREAD', entityId: threadId, safeDiff: { orgUnitId: unit.id, participantCount: joined.length } })
  await tx.outboxEvent.create({ data: {
    id: id('out'), aggregateType: 'MESSAGE_THREAD', aggregateId: threadId, aggregateVersion: aggregate.version,
    eventType: 'message.participant_added', safePayload: JSON.stringify({ threadId, companyId: unit.companyId }),
  } })
  return { threadIds: [threadId], messages }
}

/**
 * Removes people from the chats of departments they no longer belong to.
 * Membership mirrors reads (docs/decisions.md 2026-11-04): an active primary
 * assignment in the unit, or being its manager. Call after the assignment and
 * manager writes of the surrounding transaction.
 */
export async function leaveFormerOrgUnitThreads(tx: Tx, userIds: string[]): Promise<OrgUnitChatEvents> {
  const threadIds = new Set<string>()
  const now = new Date()
  for (const userId of new Set(userIds)) {
    const [assigned, managed] = await Promise.all([
      tx.userOrgAssignment.findMany({ where: { userId, endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } }, select: { orgUnitId: true } }),
      tx.orgUnit.findMany({ where: { managerId: userId, status: 'ACTIVE' }, select: { id: true } }),
    ])
    const currentUnitIds = [...assigned.map((assignment) => assignment.orgUnitId), ...managed.map((unit) => unit.id)]
    const former = await tx.threadParticipant.findMany({
      where: { userId, leftAt: null, thread: { entityType: ORG_UNIT_THREAD_ENTITY, entityId: { notIn: currentUnitIds } } },
      select: { id: true, threadId: true },
    })
    if (!former.length) continue
    await tx.threadParticipant.updateMany({ where: { id: { in: former.map((participant) => participant.id) }, leftAt: null }, data: { leftAt: now, version: { increment: 1 } } })
    for (const participant of former) threadIds.add(participant.threadId)
  }
  if (threadIds.size) await tx.messageThread.updateMany({ where: { id: { in: [...threadIds] } }, data: { version: { increment: 1 } } })
  return { threadIds: [...threadIds], messages: [] }
}
