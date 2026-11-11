import type { Prisma } from '../generated/prisma/client.js'
import { currentCorrelationId } from './correlation.js'
import { id } from './crypto.js'
import type { AuthPrincipal } from './request-context.js'

export interface AuditInput {
  action: string
  entityType: string
  entityId: string
  /** Pass null for an explicitly company-less event; omit to leave the column unset. */
  companyId?: string | null
  /** Overrides the principal's workspace (required when there is no principal). */
  workspaceId?: string
  /** Overrides the actor ID. */
  actorId?: string | null
  actorType?: 'USER' | 'SYSTEM'
  result?: string
  risk?: string
  safeDiff?: Record<string, unknown>
  reasonCode?: string | null
}

/** Accepts PrismaService and any transaction client. */
export type AuditDb = Pick<Prisma.TransactionClient, 'auditEvent'>

/**
 * Writes one audit event through `db`, so passing a transaction client keeps it in the caller's transaction.
 * The correlation ID is the current HTTP request's; jobs and CLI fall back to a fresh ID.
 * Returns the Prisma promise unawaited so it also works inside array-form `$transaction([...])`.
 */
export function recordAudit(db: AuditDb, principal: AuthPrincipal | null, input: AuditInput) {
  const workspaceId = input.workspaceId ?? principal?.workspaceId
  if (!workspaceId) throw new Error('recordAudit requires a principal or an explicit workspaceId')
  return db.auditEvent.create({ data: {
    id: id('aud'),
    workspaceId,
    companyId: input.companyId,
    actorType: input.actorType ?? (principal ? 'USER' : 'SYSTEM'),
    actorId: input.actorId ?? principal?.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    result: input.result ?? 'SUCCESS',
    risk: input.risk ?? 'NORMAL',
    safeDiffJson: input.safeDiff === undefined ? undefined : JSON.stringify(input.safeDiff),
    reasonCode: input.reasonCode,
    correlationId: currentCorrelationId() ?? id('corr'),
  } })
}
