import type {
  CreateTaskInput,
  ProjectOption,
  TagOption,
  TaskOption,
  TaskParticipantRoleV2,
  TaskPriorityV2,
  TaskRecurrenceFrequency,
  TaskRelationType,
} from '@lankadws/contracts'

export type TaskCreateSection =
  | 'main'
  | 'participants'
  | 'checklist'
  | 'planning'
  | 'relations'

export interface TaskCreateUserOption {
  id: string
  displayName: string
  avatarAsset: string | null
  jobTitle: string
}

export interface TaskCreateOptions {
  users: TaskCreateUserOption[]
  projects: ProjectOption[]
  tags: TagOption[]
  tasks: TaskOption[]
}

export interface TaskCreateParticipantDraft {
  userId: string
  role: TaskParticipantRoleV2
}

export interface TaskChecklistDraft {
  clientId: string
  title: string
  isCompleted: boolean
}

export interface TaskReminderDraft {
  clientId: string
  targetType: 'PARTICIPANTS' | 'USER'
  userId: string
  triggerType: 'AT' | 'BEFORE_START' | 'BEFORE_DUE'
  at: string
  offsetMinutes: string
}

export interface TaskRelationDraft {
  clientId: string
  targetTaskId: string
  type: TaskRelationType
  direction: 'OUTGOING' | 'INCOMING'
}

export interface TaskAttachmentDraft {
  id: string
  fileName: string
  bytes: number
  scanStatus: 'QUARANTINED' | 'SCANNING' | 'CLEAN'
  stagedAt: string
}

export interface TaskRecurrenceDraft {
  frequency: TaskRecurrenceFrequency
  interval: string
  startsAt: string
  daysOfWeek: number[]
  dayOfMonth: string
  endsAt: string
  maxOccurrences: string
}

export interface TaskCreateDraft {
  title: string
  description: string
  groupId: string
  projectId: string
  parentTaskId: string
  reporterId: string
  priority: TaskPriorityV2
  startsAt: string
  dueAt: string
  estimatedMinutes: string
  participants: TaskCreateParticipantDraft[]
  checklistItems: TaskChecklistDraft[]
  tagIds: string[]
  relations: TaskRelationDraft[]
  reminders: TaskReminderDraft[]
  recurrence: TaskRecurrenceDraft | null
  attachments: TaskAttachmentDraft[]
}

export type UpdateTaskCreateDraft = (
  update: (current: TaskCreateDraft) => TaskCreateDraft
) => void

export interface TaskCreateValidation {
  section: TaskCreateSection
  message: string
  field?: string
}

function iso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

export function mapTaskCreatePayload(draft: TaskCreateDraft): CreateTaskInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    groupId: draft.groupId || null,
    projectId: draft.projectId || null,
    parentTaskId: draft.parentTaskId || null,
    reporterId: draft.reporterId,
    priority: draft.priority,
    startsAt: iso(draft.startsAt) ?? null,
    dueAt: iso(draft.dueAt) ?? null,
    estimatedMinutes: draft.estimatedMinutes
      ? Number(draft.estimatedMinutes)
      : null,
    participants: draft.participants,
    checklistItems: draft.checklistItems
      .filter((item) => item.title.trim())
      .map((item) => ({
        clientId: item.clientId,
        title: item.title.trim(),
        isCompleted: item.isCompleted,
      })),
    tagIds: draft.tagIds,
    relations: draft.relations.map((relation) => ({
      targetTaskId: relation.targetTaskId,
      type: relation.type,
      ...(relation.type === 'BLOCKS' ? { direction: relation.direction } : {}),
    })),
    reminders: draft.reminders.map((reminder) => ({
      target: reminder.targetType === 'PARTICIPANTS'
        ? { type: 'PARTICIPANTS' as const }
        : { type: 'USER' as const, userId: reminder.userId },
      trigger: reminder.triggerType === 'AT'
        ? { type: 'AT' as const, at: iso(reminder.at)! }
        : {
            type: reminder.triggerType,
            offsetMinutes: Number(reminder.offsetMinutes),
          },
    })),
    recurrence: draft.recurrence
      ? {
          frequency: draft.recurrence.frequency,
          interval: Number(draft.recurrence.interval),
          startsAt: iso(draft.recurrence.startsAt)!,
          ...(draft.recurrence.frequency === 'WEEKLY'
            ? { daysOfWeek: draft.recurrence.daysOfWeek }
            : {}),
          ...(draft.recurrence.frequency === 'MONTHLY' && draft.recurrence.dayOfMonth
            ? { dayOfMonth: Number(draft.recurrence.dayOfMonth) }
            : {}),
          ...(draft.recurrence.endsAt
            ? { endsAt: iso(draft.recurrence.endsAt) }
            : {}),
          ...(draft.recurrence.maxOccurrences
            ? { maxOccurrences: Number(draft.recurrence.maxOccurrences) }
            : {}),
        }
      : null,
    attachmentIds: draft.attachments.map((attachment) => attachment.id),
  }
}

export function validateTaskCreateDraft(draft: TaskCreateDraft): TaskCreateValidation | null {
  if (!draft.title.trim()) {
    return { section: 'main', field: 'title', message: 'Вкажіть назву завдання.' }
  }
  if (draft.startsAt && draft.dueAt && new Date(draft.startsAt) > new Date(draft.dueAt)) {
    return {
      section: 'main',
      field: 'dueAt',
      message: 'Кінцевий термін не може бути раніше дати початку.',
    }
  }
  if (!draft.reporterId) {
    return { section: 'participants', message: 'Оберіть постановника.' }
  }
  if (!draft.participants.some((participant) => participant.role === 'RESPONSIBLE')) {
    return {
      section: 'participants',
      message: 'Додайте принаймні одного відповідального.',
    }
  }
  const emptyReminder = draft.reminders.find((reminder) => (
    (reminder.targetType === 'USER' && !reminder.userId)
    || (reminder.triggerType === 'AT' && !reminder.at)
    || (reminder.triggerType !== 'AT' && !Number(reminder.offsetMinutes))
  ))
  if (emptyReminder) {
    return { section: 'planning', message: 'Заповніть усі поля нагадування.' }
  }
  if (
    draft.reminders.some((reminder) => (
      reminder.triggerType === 'BEFORE_START' && !draft.startsAt
    ))
  ) {
    return {
      section: 'planning',
      message: 'Для нагадування до початку вкажіть дату початку.',
    }
  }
  if (
    draft.reminders.some((reminder) => (
      reminder.triggerType === 'BEFORE_DUE' && !draft.dueAt
    ))
  ) {
    return {
      section: 'planning',
      message: 'Для нагадування до дедлайну вкажіть кінцевий термін.',
    }
  }
  if (draft.recurrence) {
    if (draft.parentTaskId) {
      return {
        section: 'planning',
        message: 'Повторення доступне лише для завдання верхнього рівня.',
      }
    }
    if (!draft.recurrence.startsAt || !Number(draft.recurrence.interval)) {
      return { section: 'planning', message: 'Заповніть початок та інтервал повторення.' }
    }
    if (
      draft.recurrence.frequency === 'WEEKLY'
      && draft.recurrence.daysOfWeek.length === 0
    ) {
      return { section: 'planning', message: 'Оберіть хоча б один день тижня.' }
    }
  }
  return null
}
