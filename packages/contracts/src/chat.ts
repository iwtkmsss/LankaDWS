import { z } from 'zod'
import { companyScopeSchema } from './domain.js'
import { mentionSearchQuerySchema, structuredMentionInputSchema } from './mentions.js'

export const chatThreadKindSchema = z.enum(['DIRECT', 'GROUP', 'CONTEXTUAL', 'COMPANY'])
export type ChatThreadKind = z.infer<typeof chatThreadKindSchema>

export const chatNotificationModeSchema = z.enum(['ALL', 'NONE'])
export type ChatNotificationMode = z.infer<typeof chatNotificationModeSchema>

export const chatThreadListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})
export type ChatThreadListQuery = z.infer<typeof chatThreadListQuerySchema>

export const chatMessagePageQuerySchema = z.object({
  before: z.string().trim().min(1).max(512).optional(),
  after: z.string().trim().min(1).max(512).optional(),
  around: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).superRefine((value, context) => {
  const modes = [value.before, value.after, value.around].filter(Boolean)
  if (modes.length > 1) {
    context.addIssue({
      code: 'custom',
      message: 'Only one of before, after or around may be provided.',
    })
  }
})
export type ChatMessagePageQuery = z.infer<typeof chatMessagePageQuerySchema>

export const chatMessageSearchQuerySchema = z.object({
  q: z.string().trim().max(100).refine((value) => [...value].length >= 1, {
    message: 'Search query must contain at least one Unicode character.',
  }),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type ChatMessageSearchQuery = z.infer<typeof chatMessageSearchQuerySchema>

export const chatUserSearchQuerySchema = z.object({
  company: z.string().trim().min(1).max(120),
  q: z.string().max(100),
  limit: z.coerce.number().int().min(1).max(30).default(20),
})
export type ChatUserSearchQuery = z.infer<typeof chatUserSearchQuerySchema>

export const recommendedChatUsersQuerySchema = z.object({
  company: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(12).default(6),
})
export type RecommendedChatUsersQuery = z.infer<typeof recommendedChatUsersQuerySchema>

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
  mentions: z.array(structuredMentionInputSchema).max(100).default([]),
})
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>

export const editChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  expectedVersion: z.number().int().positive(),
  mentions: z.array(structuredMentionInputSchema).max(100).optional(),
})
export type EditChatMessageInput = z.infer<typeof editChatMessageSchema>

export const chatMentionCandidatesQuerySchema = mentionSearchQuerySchema
export type ChatMentionCandidatesQuery = z.infer<typeof chatMentionCandidatesQuerySchema>

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

export const chatContactUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  username: z.string(),
  jobTitle: z.string(),
  avatarAsset: z.string().nullable(),
})
export type ChatContactUser = z.infer<typeof chatContactUserSchema>

export const chatUserSearchPageSchema = z.object({
  items: z.array(chatContactUserSchema),
})
export type ChatUserSearchPage = z.infer<typeof chatUserSearchPageSchema>

export const recommendedChatReasonSchema = z.enum(['RECENT', 'FREQUENT', 'SHARED_CONTEXT', 'TEAM'])
export type RecommendedChatReason = z.infer<typeof recommendedChatReasonSchema>

export const recommendedChatUserSchema = chatContactUserSchema.extend({
  reason: recommendedChatReasonSchema,
})
export type RecommendedChatUser = z.infer<typeof recommendedChatUserSchema>

export const recommendedChatUsersPageSchema = z.object({
  items: z.array(recommendedChatUserSchema),
})
export type RecommendedChatUsersPage = z.infer<typeof recommendedChatUsersPageSchema>

export const chatParticipantViewSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  username: z.string(),
  jobTitle: z.string(),
  avatarAsset: z.string().nullable(),
  role: z.enum(['OWNER', 'MEMBER']),
  version: z.number().int().positive(),
})
export type ChatParticipantView = z.infer<typeof chatParticipantViewSchema>

export const chatAttachmentViewSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  mimeType: z.string().nullable(),
  scanStatus: z.enum(['QUARANTINED', 'SCANNING', 'CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED']),
})
export type ChatAttachmentView = z.infer<typeof chatAttachmentViewSchema>

export const chatThreadListItemSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  kind: chatThreadKindSchema,
  avatarAsset: z.string().nullable(),
  previewParticipants: z.array(chatContactUserSchema).max(3),
  participantCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime().nullable(),
  lastMessage: z.string(),
  lastMessageId: z.string().nullable(),
  unread: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  notificationMode: chatNotificationModeSchema,
})
export type ChatThreadListItem = z.infer<typeof chatThreadListItemSchema>

export const chatThreadCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
})
export type ChatThreadCounts = z.infer<typeof chatThreadCountsSchema>

export const chatThreadPageSchema = z.object({
  items: z.array(chatThreadListItemSchema),
  counts: chatThreadCountsSchema,
  nextCursor: z.string().nullable(),
})
export type ChatThreadPage = z.infer<typeof chatThreadPageSchema>

export const chatThreadPreviewSchema = z.object({
  item: chatThreadListItemSchema,
  counts: chatThreadCountsSchema,
})
export type ChatThreadPreview = z.infer<typeof chatThreadPreviewSchema>

export const chatMessageViewSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  replyToId: z.string().nullable(),
  mentions: z.array(z.object({
    userId: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    active: z.boolean(),
  })),
  replyPreview: z.object({
    id: z.string(),
    authorName: z.string(),
    body: z.string(),
  }).nullable(),
  author: chatContactUserSchema.pick({
    id: true,
    displayName: true,
    avatarAsset: true,
  }),
  attachments: z.array(chatAttachmentViewSchema),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
})
export type ChatMessageView = z.infer<typeof chatMessageViewSchema>

export const chatMessagePageSchema = z.object({
  items: z.array(chatMessageViewSchema),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
})
export type ChatMessagePage = z.infer<typeof chatMessagePageSchema>

export const chatMessageSearchPageSchema = z.object({
  items: z.array(chatMessageViewSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
})
export type ChatMessageSearchPage = z.infer<typeof chatMessageSearchPageSchema>

export const chatThreadDetailSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  kind: chatThreadKindSchema,
  version: z.number().int().positive(),
  notificationMode: chatNotificationModeSchema,
  participantVersion: z.number().int().positive(),
  participants: z.array(chatParticipantViewSchema),
  lastMessageId: z.string().nullable(),
  lastReadMessageId: z.string().nullable(),
  canPost: z.boolean(),
  canManageParticipants: z.boolean(),
  canLeave: z.boolean(),
})
export type ChatThreadDetail = z.infer<typeof chatThreadDetailSchema>

export const chatRealtimeEventSchema = z.object({
  threadId: z.string(),
  eventType: z.enum([
    'message.created',
    'message.edited',
    'message.deleted',
    'thread.updated',
    'thread.read',
    'participant.updated',
  ]),
  messageId: z.string().nullable(),
  occurredAt: z.string().datetime(),
})
export type ChatRealtimeEvent = z.infer<typeof chatRealtimeEventSchema>
