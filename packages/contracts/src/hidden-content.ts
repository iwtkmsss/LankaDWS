import { z } from 'zod'

/**
 * Content is hidden, never deleted (decision 2026-11-18). Administrators see a
 * hidden record with this marker; the person who hid it may undo for 10 minutes.
 */
export interface HiddenContentMarker {
  hiddenAt: string
  hiddenBy: { id: string; displayName: string } | null
}

/** Restore body for versioned content; a stale version is refused with 409. */
export const restoreHiddenContentSchema = z.object({
  expectedVersion: z.number().int().positive(),
})
export type RestoreHiddenContentInput = z.infer<typeof restoreHiddenContentSchema>
