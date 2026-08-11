import { z } from 'zod'

export const structuredMentionInputSchema = z.object({
  userId: z.string().trim().min(1).max(120),
  start: z.number().int().min(0).max(100_000),
  end: z.number().int().positive().max(100_000),
  label: z.string().trim().min(1).max(200),
}).refine((mention) => mention.end > mention.start, {
  path: ['end'],
  message: 'Mention end must be after start.',
})
export type StructuredMentionInput = z.infer<typeof structuredMentionInputSchema>

export interface StructuredMentionView {
  userId: string
  start: number
  end: number
  active: boolean
}

export interface MentionCandidateView {
  id: string
  displayName: string
  username: string
  jobTitle: string
  avatarAsset: string | null
}

export const mentionSearchQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
})
export type MentionSearchQuery = z.infer<typeof mentionSearchQuerySchema>
