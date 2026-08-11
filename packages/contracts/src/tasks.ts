import { z } from 'zod'
import { structuredMentionInputSchema } from './mentions.js'

const entityIdSchema = z.string().trim().min(1).max(120)
const isoDateTimeSchema = z.string().datetime({ offset: true })

export const taskPriorityV2Schema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
export type TaskPriorityV2 = z.infer<typeof taskPriorityV2Schema>

export const taskParticipantRoleV2Schema = z.enum([
  'RESPONSIBLE',
  'COLLABORATOR',
  'WATCHER',
])
export type TaskParticipantRoleV2 = z.infer<typeof taskParticipantRoleV2Schema>

export const taskRelationTypeSchema = z.enum(['RELATED', 'BLOCKS', 'DUPLICATES'])
export type TaskRelationType = z.infer<typeof taskRelationTypeSchema>

export const taskReminderTriggerTypeSchema = z.enum([
  'AT',
  'BEFORE_START',
  'BEFORE_DUE',
])
export type TaskReminderTriggerType = z.infer<typeof taskReminderTriggerTypeSchema>

export const taskRecurrenceFrequencySchema = z.enum([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
])
export type TaskRecurrenceFrequency = z.infer<typeof taskRecurrenceFrequencySchema>

export const taskParticipantInputSchema = z.object({
  userId: entityIdSchema,
  role: taskParticipantRoleV2Schema,
})
export type TaskParticipantInput = z.infer<typeof taskParticipantInputSchema>

export const taskCommentInputSchema = z.object({
  body: z.string().min(1).max(4_000),
  replyToCommentId: entityIdSchema.nullable().optional(),
  attachmentIds: z.array(entityIdSchema).max(5).default([]),
  mentions: z.array(structuredMentionInputSchema).max(100).default([]),
})
export type TaskCommentInput = z.infer<typeof taskCommentInputSchema>

export const taskChecklistItemInputSchema = z.object({
  clientId: entityIdSchema,
  title: z.string().trim().min(1).max(300),
  isCompleted: z.boolean().default(false),
})
export type TaskChecklistItemInput = z.infer<typeof taskChecklistItemInputSchema>

export const taskRelationInputSchema = z.object({
  targetTaskId: entityIdSchema,
  type: taskRelationTypeSchema,
  direction: z.enum(['OUTGOING', 'INCOMING']).optional(),
}).superRefine((value, context) => {
  if (value.type === 'BLOCKS' && !value.direction) {
    context.addIssue({
      code: 'custom',
      path: ['direction'],
      message: 'A blocking relation requires a direction.',
    })
  }
  if (value.type !== 'BLOCKS' && value.direction) {
    context.addIssue({
      code: 'custom',
      path: ['direction'],
      message: 'Only a blocking relation can specify a direction.',
    })
  }
})
export type TaskRelationInput = z.infer<typeof taskRelationInputSchema>

export const taskReminderTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('USER'),
    userId: entityIdSchema,
  }),
  z.object({
    type: z.literal('PARTICIPANTS'),
  }),
])
export type TaskReminderTarget = z.infer<typeof taskReminderTargetSchema>

export const taskReminderTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('AT'),
    at: isoDateTimeSchema,
  }),
  z.object({
    type: z.literal('BEFORE_START'),
    offsetMinutes: z.number().int().min(1).max(525_600),
  }),
  z.object({
    type: z.literal('BEFORE_DUE'),
    offsetMinutes: z.number().int().min(1).max(525_600),
  }),
])
export type TaskReminderTrigger = z.infer<typeof taskReminderTriggerSchema>

export const taskReminderInputSchema = z.object({
  target: taskReminderTargetSchema,
  trigger: taskReminderTriggerSchema,
})
export type TaskReminderInput = z.infer<typeof taskReminderInputSchema>

export const taskRecurrenceInputSchema = z.object({
  frequency: taskRecurrenceFrequencySchema,
  interval: z.number().int().min(1).max(365),
  startsAt: isoDateTimeSchema,
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endsAt: isoDateTimeSchema.optional(),
  maxOccurrences: z.number().int().min(2).max(10_000).optional(),
}).superRefine((value, context) => {
  if (value.frequency === 'WEEKLY' && (!value.daysOfWeek || value.daysOfWeek.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['daysOfWeek'],
      message: 'A weekly recurrence requires at least one weekday.',
    })
  }
  if (value.daysOfWeek && new Set(value.daysOfWeek).size !== value.daysOfWeek.length) {
    context.addIssue({
      code: 'custom',
      path: ['daysOfWeek'],
      message: 'Recurrence weekdays must be unique.',
    })
  }
  if (value.daysOfWeek && value.frequency !== 'WEEKLY') {
    context.addIssue({
      code: 'custom',
      path: ['daysOfWeek'],
      message: 'Only a weekly recurrence can specify weekdays.',
    })
  }
  if (value.dayOfMonth && value.frequency !== 'MONTHLY') {
    context.addIssue({
      code: 'custom',
      path: ['dayOfMonth'],
      message: 'Only a monthly recurrence can specify a day of month.',
    })
  }
  if (value.endsAt && Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Recurrence end must not be earlier than its start.',
    })
  }
})
export type TaskRecurrenceInput = z.infer<typeof taskRecurrenceInputSchema>

const createTaskBaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).default(''),
  groupId: entityIdSchema.nullable().optional(),
  projectId: entityIdSchema.nullable().optional(),
  parentTaskId: entityIdSchema.nullable().optional(),
  reporterId: entityIdSchema.optional(),
  priority: taskPriorityV2Schema.default('MEDIUM'),
  startsAt: isoDateTimeSchema.nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
  participants: z.array(taskParticipantInputSchema).min(1).max(100),
  checklistItems: z.array(taskChecklistItemInputSchema).max(200).default([]),
  tagIds: z.array(entityIdSchema).max(20).default([]),
  relations: z.array(taskRelationInputSchema).max(100).default([]),
  reminders: z.array(taskReminderInputSchema).max(20).default([]),
  recurrence: taskRecurrenceInputSchema.nullable().optional(),
  attachmentIds: z.array(entityIdSchema).max(10).default([]),
})

export const createTaskSchema = createTaskBaseSchema.superRefine((value, context) => {
  const participantIds = value.participants.map((participant) => participant.userId)
  if (new Set(participantIds).size !== participantIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['participants'],
      message: 'A user can have only one participant role.',
    })
  }
  if (!value.participants.some((participant) => participant.role === 'RESPONSIBLE')) {
    context.addIssue({
      code: 'custom',
      path: ['participants'],
      message: 'At least one responsible participant is required.',
    })
  }
  if (value.startsAt && value.dueAt && Date.parse(value.startsAt) > Date.parse(value.dueAt)) {
    context.addIssue({
      code: 'custom',
      path: ['dueAt'],
      message: 'Task due date must not be earlier than its start.',
    })
  }
  if (value.parentTaskId && value.recurrence) {
    context.addIssue({
      code: 'custom',
      path: ['recurrence'],
      message: 'Only a top-level task can recur.',
    })
  }

  for (const [index, reminder] of value.reminders.entries()) {
    if (reminder.trigger.type === 'BEFORE_START' && !value.startsAt) {
      context.addIssue({
        code: 'custom',
        path: ['reminders', index, 'trigger'],
        message: 'A reminder before start requires a task start date.',
      })
    }
    if (reminder.trigger.type === 'BEFORE_DUE' && !value.dueAt) {
      context.addIssue({
        code: 'custom',
        path: ['reminders', index, 'trigger'],
        message: 'A reminder before due date requires a task due date.',
      })
    }
  }

  const relationKeys = value.relations.map((relation) => relation.targetTaskId)
  if (new Set(relationKeys).size !== relationKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['relations'],
      message: 'A task can have only one relation to the same target.',
    })
  }
})
export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const updateTaskSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(20_000).optional(),
  groupId: entityIdSchema.nullable().optional(),
  projectId: entityIdSchema.nullable().optional(),
  parentTaskId: entityIdSchema.nullable().optional(),
  reporterId: entityIdSchema.optional(),
  priority: taskPriorityV2Schema.optional(),
  startsAt: isoDateTimeSchema.nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
})
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const manualTimeEntrySchema = z.object({
  startedAt: isoDateTimeSchema,
  durationSeconds: z.number().int().min(1).max(86_400),
  description: z.string().trim().max(500).default(''),
})
export type ManualTimeEntryInput = z.infer<typeof manualTimeEntrySchema>

export const updateTimeEntrySchema = z.object({
  startedAt: isoDateTimeSchema.optional(),
  durationSeconds: z.number().int().min(1).max(86_400).optional(),
  description: z.string().trim().max(500).optional(),
  expectedUpdatedAt: isoDateTimeSchema,
})
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>

export const projectOptionSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(120),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
})
export type ProjectOption = z.infer<typeof projectOptionSchema>

export const tagOptionSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(50),
  color: z.string().nullable(),
})
export type TagOption = z.infer<typeof tagOptionSchema>

export const taskOptionSchema = z.object({
  id: entityIdSchema,
  number: z.string().regex(/^\d+$/).max(80),
  title: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  groupId: entityIdSchema.nullable(),
  projectId: entityIdSchema.nullable(),
  parentTaskId: entityIdSchema.nullable(),
})
export type TaskOption = z.infer<typeof taskOptionSchema>
