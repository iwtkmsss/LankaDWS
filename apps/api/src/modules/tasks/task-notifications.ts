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
    return details.length ? `Зміни: ${details.join('; ')}` : null
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
  }
  return labels[action] ?? null
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
  const effectiveActorId = actorId ?? (['task.created', 'task.recurrence_created'].includes(action) ? task.createdById : null)
  const recipientIds = [...new Set([task.createdById, task.reporterId, ...task.participants.map((p) => p.userId)])].filter((userId) => userId !== effectiveActorId || (diff.change === 'DELEGATED' && userId === diff.previousResponsibleId) || (action === 'task.status_changed' && (diff.status as { from?: string } | undefined)?.from === 'DONE'))
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
