/**
 * The person who hid a record may undo it for a short window (decision
 * 2026-11-18, «Скасувати» on the success notice). Afterwards only the existing
 * owner restore paths or a global administrator can restore it.
 */
export const ACTOR_RESTORE_WINDOW_MS = 10 * 60_000

/** True when `principalUserId` hid the record and the window has not elapsed. */
export function canActorRestore(
  hiddenById: string | null | undefined,
  hiddenAt: Date | null | undefined,
  principalUserId: string,
  now: Date = new Date(),
): boolean {
  if (!hiddenById || !hiddenAt || hiddenById !== principalUserId) return false
  return now.getTime() - hiddenAt.getTime() <= ACTOR_RESTORE_WINDOW_MS
}
