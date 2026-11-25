import { forbidden } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { canActorRestore } from '../../common/restore-window.js'

/**
 * Restore rule for hidden task content (decision 2026-11-18): a global
 * administrator always may; the person who hid it may within the actor window;
 * `ownerMayRestore` keeps an owner restore path that already exists (a task's
 * reporter/creator unarchiving their own task). Callers check read access first.
 */
export function assertTaskRestoreAllowed(
  principal: AuthPrincipal,
  hiddenById: string | null | undefined,
  hiddenAt: Date | null | undefined,
  ownerMayRestore = false,
): void {
  if (
    isGlobalAdmin(principal)
    || ownerMayRestore
    || canActorRestore(hiddenById, hiddenAt, principal.userId)
  ) {
    return
  }
  throw forbidden()
}

/** Status a restored task returns to; the archive audit event records the previous one. */
export function restoredTaskStatus(archiveSafeDiffJson: string | null | undefined): 'NEW' | 'IN_PROGRESS' | 'DONE' {
  let previous: unknown
  try {
    previous = (JSON.parse(archiveSafeDiffJson ?? '{}') as { previousStatus?: unknown }).previousStatus
  } catch {
    previous = undefined
  }
  if (previous === 'IN_PROGRESS' || previous === 'DONE') return previous
  // Archiving invalidated the pending review round, so a task that was in review
  // goes back to work and is submitted again (a fresh round) instead of waiting
  // on a review that no longer exists.
  if (previous === 'IN_REVIEW') return 'IN_PROGRESS'
  return 'NEW'
}
