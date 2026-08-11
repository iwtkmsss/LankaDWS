import { z } from 'zod'

export const TASK_DETAIL_PREFERENCE_MODULE = 'TASKS' as const
export const TASK_DETAIL_PREFERENCE_KEY = 'DETAIL_LAYOUT' as const
export const TASK_DETAIL_PREFERENCE_SCHEMA_VERSION = 1 as const
export const TASK_LIST_COLUMNS_PREFERENCE_KEY = 'LIST_COLUMNS' as const
export const TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION = 1 as const

export const TASK_DETAIL_SECTION_IDS = [
  'personal',
  'participants',
  'subtasks',
  'checklist',
  'recurrence',
  'materials',
  'history',
  'discussion',
] as const

export const taskDetailSectionIdSchema = z.enum(TASK_DETAIL_SECTION_IDS)
export type TaskDetailSectionId = z.infer<typeof taskDetailSectionIdSchema>

const uniqueSectionIds = (values: TaskDetailSectionId[]) => new Set(values).size === values.length

export const taskDetailPreferenceValueSchema = z.object({
  order: z.array(taskDetailSectionIdSchema).length(TASK_DETAIL_SECTION_IDS.length),
  hidden: z.array(taskDetailSectionIdSchema).max(TASK_DETAIL_SECTION_IDS.length),
  collapsed: z.array(taskDetailSectionIdSchema).max(TASK_DETAIL_SECTION_IDS.length),
}).strict().superRefine((value, context) => {
  if (!uniqueSectionIds(value.order)) {
    context.addIssue({ code: 'custom', path: ['order'], message: 'Section order must not contain duplicates.' })
  }
  if (!uniqueSectionIds(value.hidden)) {
    context.addIssue({ code: 'custom', path: ['hidden'], message: 'Hidden sections must not contain duplicates.' })
  }
  if (!uniqueSectionIds(value.collapsed)) {
    context.addIssue({ code: 'custom', path: ['collapsed'], message: 'Collapsed sections must not contain duplicates.' })
  }
})
export type TaskDetailPreferenceValue = z.infer<typeof taskDetailPreferenceValueSchema>

export const putTaskDetailPreferenceSchema = z.object({
  schemaVersion: z.literal(TASK_DETAIL_PREFERENCE_SCHEMA_VERSION),
  value: taskDetailPreferenceValueSchema,
  expectedVersion: z.number().int().min(0),
}).strict()
export type PutTaskDetailPreference = z.infer<typeof putTaskDetailPreferenceSchema>

export const resetTaskDetailPreferenceSchema = z.object({
  expectedVersion: z.number().int().min(0),
}).strict()
export type ResetTaskDetailPreference = z.infer<typeof resetTaskDetailPreferenceSchema>

export const userUiPreferenceViewSchema = z.object({
  module: z.literal(TASK_DETAIL_PREFERENCE_MODULE),
  key: z.literal(TASK_DETAIL_PREFERENCE_KEY),
  schemaVersion: z.literal(TASK_DETAIL_PREFERENCE_SCHEMA_VERSION),
  value: taskDetailPreferenceValueSchema,
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
}).strict()
export type UserUiPreferenceView = z.infer<typeof userUiPreferenceViewSchema>

export const userUiPreferenceResultSchema = z.object({
  preference: userUiPreferenceViewSchema.nullable(),
}).strict()
export type UserUiPreferenceResult = z.infer<typeof userUiPreferenceResultSchema>

export const TASK_LIST_COLUMN_IDS = [
  'responsibles',
  'dueDate',
  'status',
  'reporter',
  'group',
  'priority',
  'subtaskProgress',
  'activity',
] as const

export const taskListColumnIdSchema = z.enum(TASK_LIST_COLUMN_IDS)
export type TaskListColumnId = z.infer<typeof taskListColumnIdSchema>

export const taskListColumnsPreferenceValueSchema = z.object({
  visible: z.array(taskListColumnIdSchema).max(5),
}).strict().superRefine((value, context) => {
  if (new Set(value.visible).size !== value.visible.length) {
    context.addIssue({ code: 'custom', path: ['visible'], message: 'Columns must not contain duplicates.' })
  }
})
export type TaskListColumnsPreferenceValue = z.infer<typeof taskListColumnsPreferenceValueSchema>

export const putTaskListColumnsPreferenceSchema = z.object({
  schemaVersion: z.literal(TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION),
  value: taskListColumnsPreferenceValueSchema,
  expectedVersion: z.number().int().min(0),
}).strict()
export type PutTaskListColumnsPreference = z.infer<typeof putTaskListColumnsPreferenceSchema>

export const resetTaskListColumnsPreferenceSchema = z.object({
  expectedVersion: z.number().int().min(0),
}).strict()

export const taskListColumnsUserUiPreferenceViewSchema = z.object({
  module: z.literal(TASK_DETAIL_PREFERENCE_MODULE),
  key: z.literal(TASK_LIST_COLUMNS_PREFERENCE_KEY),
  schemaVersion: z.literal(TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION),
  value: taskListColumnsPreferenceValueSchema,
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
}).strict()
export type TaskListColumnsUserUiPreferenceView = z.infer<typeof taskListColumnsUserUiPreferenceViewSchema>

export const taskListColumnsUserUiPreferenceResultSchema = z.object({
  preference: taskListColumnsUserUiPreferenceViewSchema.nullable(),
}).strict()
export type TaskListColumnsUserUiPreferenceResult = z.infer<typeof taskListColumnsUserUiPreferenceResultSchema>
