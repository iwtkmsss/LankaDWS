import { z } from 'zod'
import { companyScopeSchema } from './domain.js'
import { mentionSearchQuerySchema, structuredMentionInputSchema, type StructuredMentionView } from './mentions.js'

export const feedPostStatusSchema = z.enum(['PUBLISHED', 'ARCHIVED'])
export type FeedPostStatus = z.infer<typeof feedPostStatusSchema>

export const feedRecipientTypeSchema = z.enum(['COMPANY', 'GROUP', 'USER'])
export type FeedRecipientType = z.infer<typeof feedRecipientTypeSchema>

export const feedListFilterSchema = z.enum(['ALL', 'ACK_REQUIRED', 'MINE', 'FOLLOWING'])
export type FeedListFilter = z.infer<typeof feedListFilterSchema>

export const feedItemTypeSchema = z.enum(['ALL', 'POST', 'TASK', 'EVENT', 'ANNOUNCEMENT', 'FILE'])
export type FeedItemType = z.infer<typeof feedItemTypeSchema>

export const feedSubscriptionModeSchema = z.enum(['ALL', 'MENTIONS', 'NONE'])
export type FeedSubscriptionMode = z.infer<typeof feedSubscriptionModeSchema>

export const updateFeedSubscriptionSchema = z.object({
  notificationMode: feedSubscriptionModeSchema,
})
export type UpdateFeedSubscriptionInput = z.infer<typeof updateFeedSubscriptionSchema>

export const feedListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  filter: feedListFilterSchema.default('ALL'),
  type: feedItemTypeSchema.default('ALL'),
  authorId: z.string().trim().min(1).max(120).optional(),
  groupId: z.string().trim().min(1).max(120).optional(),
  audienceId: z.string().trim().min(1).max(120).optional(),
  mentioned: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  favorite: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  important: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom',
      path: ['dateTo'],
      message: 'dateTo must not be earlier than dateFrom.',
    })
  }
})
export type FeedListQuery = z.infer<typeof feedListQuerySchema>

export const feedMentionCandidatesQuerySchema = mentionSearchQuerySchema.extend({
  company: companyScopeSchema,
  audienceType: z.enum(['COMPANY', 'GROUP']),
  audienceId: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, context) => {
  if (value.audienceType === 'GROUP' && !value.audienceId) {
    context.addIssue({ code: 'custom', path: ['audienceId'], message: 'Group audience requires audienceId.' })
  }
})
export type FeedMentionCandidatesQuery = z.infer<typeof feedMentionCandidatesQuerySchema>

export const feedAudienceInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('COMPANY') }),
  z.object({ type: z.literal('GROUP'), groupId: z.string().trim().min(1).max(120) }),
  z.object({
    type: z.literal('USERS'),
    userIds: z.array(z.string().trim().min(1).max(120)).min(1).max(100)
      .transform((items) => [...new Set(items)]),
  }),
])
export type FeedAudienceInput = z.infer<typeof feedAudienceInputSchema>

export const shareFileToFeedSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  audience: feedAudienceInputSchema,
})
export type ShareFileToFeedInput = z.infer<typeof shareFileToFeedSchema>

export const createFeedPostSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(10_000),
  audience: feedAudienceInputSchema,
  requiresAcknowledgement: z.boolean().default(false),
  attachmentIds: z.array(z.string().trim().min(1).max(120)).max(10)
    .transform((items) => [...new Set(items)])
    .default([]),
  mentionedUserIds: z.array(z.string().trim().min(1).max(120)).max(100)
    .transform((items) => [...new Set(items)])
    .default([]),
  mentions: z.array(structuredMentionInputSchema).max(100).default([]),
})
export type CreateFeedPostInput = z.infer<typeof createFeedPostSchema>

export const updateFeedPostSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  expectedVersion: z.number().int().positive(),
  mentionedUserIds: z.array(z.string().trim().min(1).max(120)).max(100)
    .transform((items) => [...new Set(items)])
    .optional(),
  mentions: z.array(structuredMentionInputSchema).max(100).optional(),
})
export type UpdateFeedPostInput = z.infer<typeof updateFeedPostSchema>

export const createFeedCommentSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
  replyToCommentId: z.string().trim().min(1).max(120).nullable().optional(),
  mentionedUserIds: z.array(z.string().trim().min(1).max(120)).max(100)
    .transform((items) => [...new Set(items)])
    .default([]),
  mentions: z.array(structuredMentionInputSchema).max(100).default([]),
})
export type CreateFeedCommentInput = z.infer<typeof createFeedCommentSchema>

export const acknowledgeFeedPostSchema = z.object({
  acknowledgementVersion: z.number().int().positive(),
})
export type AcknowledgeFeedPostInput = z.infer<typeof acknowledgeFeedPostSchema>

export const markFeedReadSchema = z.object({
  markers: z.array(z.object({
    companyId: z.string().trim().min(1).max(120),
    lastItemId: z.string().trim().min(1).max(120),
  })).min(1).max(50),
}).superRefine((value, context) => {
  const companyIds = value.markers.map((marker) => marker.companyId)
  if (new Set(companyIds).size !== companyIds.length) {
    context.addIssue({ code: 'custom', path: ['markers'], message: 'Each company can appear only once.' })
  }
})
export type MarkFeedReadInput = z.infer<typeof markFeedReadSchema>

export interface FeedAudienceOption {
  type: 'COMPANY' | 'GROUP'
  id: string
  companyId: string
  label: string
  detail: string
}

export interface FeedAuthorOption {
  id: string
  displayName: string
  avatarAsset: string | null
}

export interface FeedAudienceFacetOption {
  type: 'COMPANY' | 'GROUP' | 'USER'
  id: string
  label: string
  detail: string
  queryKey: 'audienceId' | 'groupId'
}

export interface FeedCommentView {
  id: string
  author: {
    id: string
    displayName: string
    avatarAsset: string | null
  }
  body: string
  mentions: StructuredMentionView[]
  replyToCommentId: string | null
  createdAt: string
  editedAt: string | null
}

export interface FeedAttachmentView {
  id: string
  fileName: string
  bytes: number
  mimeType: string
  scanStatus: 'QUARANTINED' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'UNSUPPORTED' | 'FAILED'
}

export interface FeedPostView {
  kind: 'POST'
  id: string
  itemId: string
  companyId: string
  group: { id: string; name: string } | null
  author: {
    id: string
    displayName: string
    avatarAsset: string | null
  }
  audienceLabel: string
  body: string
  mentions: StructuredMentionView[]
  status: FeedPostStatus
  requiresAcknowledgement: boolean
  acknowledgementVersion: number
  acknowledgementRequiredForMe: boolean
  hasAcknowledged: boolean
  acknowledgementCount: number
  acknowledgementRecipientCount: number
  likedByMe: boolean
  likeCount: number
  commentCount: number
  comments: FeedCommentView[]
  attachments: FeedAttachmentView[]
  subscriptionMode: FeedSubscriptionMode
  favoritedByMe: boolean
  publishedAt: string
  editedAt: string | null
  version: number
  canEdit: boolean
  canModerate: boolean
}

export interface FeedSourceView {
  kind: 'SOURCE'
  id: string
  itemId: string
  companyId: string
  sourceType: 'TASK' | 'EVENT' | 'ANNOUNCEMENT' | 'FILE'
  action: string
  actor: {
    id: string
    displayName: string
    avatarAsset: string | null
  } | null
  label: string
  title: string
  summary: string
  metadata: string[]
  href: string
  actionState: 'AVAILABLE' | 'PROCESSING' | 'BLOCKED'
  occurredAt: string
  historical: boolean
  favoritedByMe: boolean
  version: number
  canRevoke: boolean
}

export type FeedEntryView = FeedPostView | FeedSourceView

export interface FeedBirthdayView {
  id: string
  displayName: string
  avatarAsset: string | null
  jobTitle: string
}

export interface FeedListResult {
  items: FeedEntryView[]
  birthdays: FeedBirthdayView[]
  nextCursor: string | null
  unreadCount: number
  attention: {
    pendingAcknowledgements: number
    overdueTasks: number
  }
  readMarkers: Array<{ companyId: string; lastItemId: string }>
}
