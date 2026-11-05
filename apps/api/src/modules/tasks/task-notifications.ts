import { writeFeedProjection } from '../feed/feed-projection.service.js'
import { id } from '../../common/crypto.js'
import type { TaskTransaction } from './task-types.js'

const fields: Record<string, string> = {
  title: 'назву', description: 'опис', assignee: 'відповідального', creator: 'постановника',
  reporterId: 'постановника', projectId: 'проєкт', parentTaskId: 'батьківське завдання',
  deadline: 'строк', dueAt: 'строк', startsAt: 'дату початку', priority: 'пріоритет',
  estimatedMinutes: 'оцінку часу', blockReason: 'причину блокування', requiresAcceptance: 'перевірку результату',
}
const statuses: Record<string, string> = { NEW: 'Нове', IN_PROGRESS: 'В роботі', IN_REVIEW: 'На перевірці', DONE: 'Завершене', ARCHIVED: 'Архівоване' }

export function taskNotificationTitle(action: string, diff: Record<string, unknown> = {}): string | null {
  // A reminder is set for later and delivered on its own when it is due, and
  // time tracking is a person's own log. Neither is news for the others.
  if (action === 'task.reminder_changed' || /^task\.time(r)?_/.test(action)) return null
  // A mention adds its target as a watcher; the comment's own alerts already say so.
  if (diff.change === 'MENTION_ADDED') return null
  if (['task.created', 'task.recurrence_created'].includes(action)) return 'Нове завдання'
  if (action === 'task.updated') {
    const changed = Array.isArray(diff.changedFields) ? diff.changedFields : []
    const changes = (diff.changes ?? {}) as Record<string, unknown>
    const details = changed.filter((field): field is string => typeof field === 'string').map((field) => {
      const value = changes[field]
      if (field === 'title' && typeof value === 'string') return `назва: «${value.slice(0, 70)}»`
      if (field === 'assignee' && typeof changes.assigneeName === 'string') return `відповідальний: ${changes.assigneeName}`
      if (field === 'creator' && typeof changes.creatorName === 'string') return `постановник: ${changes.creatorName}`
      if (['deadline', 'dueAt', 'startsAt'].includes(field) && (typeof value === 'string' || value === null)) {
        return `${fields[field]}: ${value === null ? 'без дати' : new Date(value).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })}`
      }
      if (field === 'priority' && typeof value === 'string') return `пріоритет: ${({ LOW: 'низький', MEDIUM: 'середній', HIGH: 'високий', CRITICAL: 'терміновий' } as Record<string, string>)[value] ?? value}`
      return fields[field] ?? 'параметри завдання'
    })
    return details.length ? `Зміни: ${details.join('; ')}` : 'Завдання оновлено'
  }
  if (action === 'task.status_changed') {
    const status = diff.status as { from?: string; to?: string } | undefined
    if (status?.from === 'DONE' && status.to === 'IN_PROGRESS') return 'Завдання відновлено — в роботі'
    return status?.from && status.to ? `Статус: ${statuses[status.from] ?? status.from} → ${statuses[status.to] ?? status.to}` : 'Статус завдання змінено'
  }
  if (action === 'task.checklist_changed') return typeof diff.detail === 'string' ? diff.detail : 'Змінено чекліст завдання'
  const labels: Record<string, string> = {
    'task.archived': 'Завдання архівовано', 'task.attachment_added': 'Додано вкладення до завдання',
    'task.attachment_removed': 'Вилучено вкладення із завдання', 'task.subtask_created': 'Додано підзавдання',
    'task.participant_added': 'Додано учасника завдання', 'task.participant_changed': 'Змінено учасників завдання',
    'task.participant_removed': 'Вилучено учасника завдання',
    'task.comment_created': 'Нове повідомлення у завданні',
    'task.comment_updated': 'Повідомлення у завданні змінено',
    'task.comment_deleted': 'Повідомлення у завданні вилучено',
    'task.reaction_changed': 'Ваше повідомлення у завданні вподобали',
  }
  return labels[action] ?? 'Завдання оновлено'
}

/** Whatever a task asked of people is settled once its status moves on. */
export async function settleTaskActions(tx: TaskTransaction, taskId: string, recipientId?: string): Promise<void> {
  await tx.notification.updateMany({
    where: { entityType: 'TASK', entityId: taskId, requiresAction: true, ...(recipientId ? { recipientId } : {}) },
    data: { requiresAction: false },
  })
}

/** People who already received a dedicated alert about this very change. */
async function recipientsWithDedicatedAlert(
  tx: TaskTransaction, taskId: string, version: number, action: string, diff: Record<string, unknown>,
): Promise<Set<string>> {
  const status = diff.status as { from?: string; to?: string } | undefined
  let where: { dedupeKey: { in: string[] } | { startsWith: string } } | null = null
  if (action === 'task.status_changed' && (status?.to === 'IN_REVIEW' || status?.from === 'IN_REVIEW')) {
    where = { dedupeKey: { in: [`task-review:${taskId}:${version}`, `task-returned:${taskId}:${version}`] } }
  } else if (action === 'task.comment_updated' && typeof diff.commentId === 'string' && typeof diff.commentVersion === 'number') {
    where = { dedupeKey: { startsWith: `task-comment-edited:${diff.commentId}:${diff.commentVersion}:` } }
  }
  if (!where) return new Set()
  const rows = await tx.notification.findMany({ where, select: { recipientId: true } })
  return new Set(rows.map((row) => row.recipientId))
}

export async function notifyTaskParticipants(
  tx: TaskTransaction, taskId: string, actorId: string | null, version: number,
  action: string, diff: Record<string, unknown> = {},
): Promise<string[]> {
  let title = taskNotificationTitle(action, diff)
  if (!title) return []
  if (action.startsWith('task.participant_') && typeof diff.userId === 'string') {
    const person = await tx.user.findUnique({ where: { id: diff.userId }, select: { displayName: true } })
    const roles: Record<string, string> = { RESPONSIBLE: 'Відповідальний', COLLABORATOR: 'Співвиконавець', WATCHER: 'Спостерігач' }
    const role = typeof diff.role === 'string' ? roles[diff.role] ?? 'Учасник' : 'Учасник'
    title = diff.change === 'DELEGATED' ? `Завдання делеговано · відповідальний: ${person?.displayName ?? 'учасник'}` : `${role}: ${person?.displayName ?? 'склад змінено'}${diff.change === 'REMOVED' ? ' — вилучено' : ''}`
  }
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: { participants: { where: { removedAt: null }, select: { userId: true, role: true } } },
  })
  if (!task) return []
  // A like concerns the comment's author; it neither moves the card nor involves the others.
  const isReaction = action === 'task.reaction_changed'
  if (!isReaction) {
    await writeFeedProjection(tx, {
      workspaceId: task.workspaceId, companyId: task.companyId,
      sourceType: 'TASK', sourceId: task.id, sourceVersion: version,
      action: action.replace(/^task\./, '').toUpperCase(), actorId,
      recipientIds: [task.createdById, task.reporterId, ...task.participants.map((p) => p.userId)],
      visibility: 'PARTICIPANTS', occurredAt: task.updatedAt,
      taskDetails: {
        ...(typeof diff.role === 'string' ? { role: diff.role } : {}),
        ...(typeof diff.change === 'string' ? { change: diff.change } : {}),
        changedFields: Array.isArray(diff.changedFields) ? diff.changedFields.filter((field): field is string => typeof field === 'string') : [],
      },
    })
  }
  if (diff.change === 'DELEGATED' && typeof diff.previousResponsibleId === 'string') {
    await settleTaskActions(tx, taskId, diff.previousResponsibleId)
  }
  const effectiveActorId = actorId ?? (['task.created', 'task.recurrence_created'].includes(action) ? task.createdById : null)
  const audience = isReaction
    ? (typeof diff.commentAuthorId === 'string' ? [diff.commentAuthorId] : [])
    : [task.createdById, task.reporterId, ...task.participants.map((p) => p.userId)]
  const alreadyAlerted = await recipientsWithDedicatedAlert(tx, taskId, version, action, diff)
  const recipientIds = [...new Set(audience)].filter((userId) => !alreadyAlerted.has(userId)).filter((userId) => userId !== effectiveActorId || (diff.change === 'DELEGATED' && userId === diff.previousResponsibleId) || (action === 'task.status_changed' && (diff.status as { from?: string } | undefined)?.from === 'DONE'))
  const recipients = await tx.user.findMany({ where: { id: { in: recipientIds }, workspaceId: task.workspaceId, isActive: true }, select: { id: true } })
  for (const recipient of recipients) {
    const dedupeKey = `task-event:${taskId}:${version}:${action}:${recipient.id}`
    await tx.notification.upsert({
      where: { dedupeKey }, update: {},
      create: {
        id: id('ntf'), recipientId: recipient.id, category: 'TASKS',
        safeTitle: (diff.change === 'DELEGATED' && recipient.id === diff.previousResponsibleId ? 'Завдання делеговано — ви тепер спостерігач' : title).slice(0, 240), safeSnippet: `№${task.number} · ${task.title}`.slice(0, 180),
        entityType: 'TASK', entityId: taskId, deliveredAt: new Date(), dedupeKey,
        requiresAction: (['task.created', 'task.recurrence_created'].includes(action) || diff.change === 'DELEGATED') && task.participants.some((p) => p.userId === recipient.id && p.role === 'RESPONSIBLE'),
      },
    })
  }
  return recipients.map((recipient) => recipient.id)
}
