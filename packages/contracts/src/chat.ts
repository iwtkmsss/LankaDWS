import { z } from 'zod'
import { companyScopeSchema } from './domain.js'

export const chatThreadKindSchema = z.enum(['DIRECT', 'GROUP', 'CONTEXTUAL', 'COMPANY'])
export type ChatThreadKind = z.infer<typeof chatThreadKindSchema>

export const chatNotificationModeSchema = z.enum(['ALL', 'NONE'])
export type ChatNotificationMode = z.infer<typeof chatNotificationModeSchema>

export const chatThreadListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  query: z.string().trim().max(100).optional(),
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
})
export type ChatThreadListQuery = z.infer<typeof chatThreadListQuerySchema>

export const createChatThreadSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  kind: z.enum(['DIRECT', 'GROUP']),
  title: z.string().trim().max(120).optional(),
  participantIds: z.array(z.string().trim().min(1).max(120)).min(1).max(49)
    .transform((items) => [...new Set(items)].sort()),
}).superRefine((value, context) => {
  if (value.kind === 'DIRECT' && value.participantIds.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['participantIds'],
      message: 'A direct thread requires exactly one other participant.',
    })
  }
  if (value.kind === 'GROUP' && value.participantIds.length < 2) {
    context.addIssue({
      code: 'custom',
      path: ['participantIds'],
      message: 'A group thread requires at least two other participants.',
    })
  }
  if (value.kind === 'GROUP' && (!value.title || value.title.length < 2)) {
    context.addIssue({
      code: 'custom',
      path: ['title'],
      message: 'A group thread requires a title.',
    })
  }
})
export type CreateChatThreadInput = z.infer<typeof createChatThreadSchema>

export const sendChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  replyToId: z.string().trim().min(1).max(120).nullable().optional(),
  attachmentIds: z.array(z.string().trim().min(1).max(120)).max(5).default([])
    .transform((items) => [...new Set(items)].sort()),
})
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>

export const editChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  expectedVersion: z.number().int().positive(),
})
export type EditChatMessageInput = z.infer<typeof editChatMessageSchema>

export const deleteChatMessageSchema = z.object({
  expectedVersion: z.number().int().positive(),
})
export type DeleteChatMessageInput = z.infer<typeof deleteChatMessageSchema>

export const convertChatMessageToTaskSchema = z.object({
  title: z.string().trim().min(2).max(180),
  assigneeId: z.string().trim().min(1).max(120),
  deadline: z.string().datetime().optional(),
})
export type ConvertChatMessageToTaskInput = z.infer<typeof convertChatMessageToTaskSchema>

export const convertChatMessageToEventSchema = z.object({
  title: z.string().trim().min(2).max(180),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  sourceTimezone: z.string().trim().min(1).max(80).default('Europe/Kyiv'),
  allDay: z.boolean().default(false),
}).superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endAt'],
      message: 'Event end must be after its start.',
    })
  }
})
export type ConvertChatMessageToEventInput = z.infer<typeof convertChatMessageToEventSchema>

export const createCalendarEventSchema = z.intersection(
  z.object({ companyId: z.string().trim().min(1).max(120) }),
  convertChatMessageToEventSchema,
)
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>

export const updateCalendarEventSchema = z.intersection(
  z.object({ expectedVersion: z.number().int().positive() }),
  convertChatMessageToEventSchema,
)
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>

export const markChatReadSchema = z.object({
  lastReadMessageId: z.string().trim().min(1).max(120),
})
export type MarkChatReadInput = z.infer<typeof markChatReadSchema>

export const updateChatPreferenceSchema = z.object({
  notificationMode: chatNotificationModeSchema,
  expectedVersion: z.number().int().positive(),
})
export type UpdateChatPreferenceInput = z.infer<typeof updateChatPreferenceSchema>

export const addChatParticipantSchema = z.object({
  userId: z.string().trim().min(1).max(120),
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
  expectedThreadVersion: z.number().int().positive(),
})
export type AddChatParticipantInput = z.infer<typeof addChatParticipantSchema>

export const updateChatParticipantSchema = z.object({
  role: z.enum(['OWNER', 'MEMBER']),
  expectedVersion: z.number().int().positive(),
  expectedThreadVersion: z.number().int().positive(),
})
export type UpdateChatParticipantInput = z.infer<typeof updateChatParticipantSchema>

export const removeChatParticipantSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedThreadVersion: z.number().int().positive(),
})
export type RemoveChatParticipantInput = z.infer<typeof removeChatParticipantSchema>

export interface ChatParticipantView {
  id: string
  displayName: string
  avatarAsset: string | null
  role: 'OWNER' | 'MEMBER'
  version: number
}

export interface ChatAttachmentView {
  id: string
  fileName: string
  bytes: number
  mimeType: string | null
  scanStatus: 'QUARANTINED' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'UNSUPPORTED' | 'FAILED'
}

export interface ChatThreadListItem {
  id: string
  companyId: string
  title: string
  kind: ChatThreadKind
  avatarAsset: string | null
  participantCount: number
  lastMessageAt: string | null
  lastMessage: string
  lastMessageId: string | null
  unread: boolean
  notificationMode: ChatNotificationMode
}

export interface ChatMessageView {
  id: string
  authorId: string
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  version: number
  replyToId: string | null
  replyPreview: {
    id: string
    authorName: string
    body: string
  } | null
  author: {
    id: string
    displayName: string
    avatarAsset: string | null
  }
  attachments: ChatAttachmentView[]
  canEdit: boolean
  canDelete: boolean
}

export interface ChatThreadDetail {
  id: string
  companyId: string
  title: string
  kind: ChatThreadKind
  version: number
  notificationMode: ChatNotificationMode
  participantVersion: number
  participants: ChatParticipantView[]
  messages: ChatMessageView[]
  lastMessageId: string | null
  canPost: boolean
  canManageParticipants: boolean
  canLeave: boolean
}
