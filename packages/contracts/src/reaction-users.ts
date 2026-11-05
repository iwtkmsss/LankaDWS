import { z } from 'zod'

export const reactionUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  cursor: z.string().regex(/^\d{1,9}$/).optional(),
})
export type ReactionUsersQuery = z.infer<typeof reactionUsersQuerySchema>

export const reactionUsersPageSchema = z.object({
  items: z.array(z.object({ id: z.string(), displayName: z.string() })),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
})
export type ReactionUsersPage = z.infer<typeof reactionUsersPageSchema>
