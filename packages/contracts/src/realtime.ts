import { z } from 'zod'

export const realtimeSummaryChangedSchema = z.object({
  kinds: z.array(z.enum(['feed', 'notifications'])).min(1),
  occurredAt: z.string().datetime(),
})
export type RealtimeSummaryChanged = z.infer<typeof realtimeSummaryChangedSchema>
