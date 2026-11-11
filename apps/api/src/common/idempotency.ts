import type { Prisma } from '../generated/prisma/client.js'
import { id } from './crypto.js'
import { badRequest, conflict } from './errors.js'

/** How long a stored result answers retries of the same request. */
const IDEMPOTENCY_TTL_MS = 86_400_000

/**
 * One idempotent operation of one user. `fingerprint` identifies the request body: a retry with
 * the same key and fingerprint returns the stored result, the same key with another fingerprint
 * is rejected. A caller that wants key-only semantics passes the key as the fingerprint.
 */
export interface IdempotencyScope {
  userId: string
  key: string
  operation: string
  fingerprint: string
}

type IdempotencyStore = Pick<Prisma.TransactionClient, 'idempotencyRecord'>

/** Rejects a missing or oversized `idempotency-key` header. */
export function assertIdempotencyKey(key: string | undefined): asserts key is string {
  if (!key || key.length > 200) throw badRequest('idempotency_key_required')
}

/**
 * The stored result of an earlier request with this key, or null when there was none.
 * Throws 409 when the key was already used for a different request.
 */
export async function findIdempotentResult(
  db: IdempotencyStore,
  scope: IdempotencyScope,
): Promise<{ resultId: string | null } | null> {
  const existing = await db.idempotencyRecord.findUnique({
    where: { userId_key_operation: { userId: scope.userId, key: scope.key, operation: scope.operation } },
    select: { requestFingerprint: true, resultId: true },
  })
  if (!existing) return null
  if (existing.requestFingerprint !== scope.fingerprint) {
    throw conflict('Цей ключ повтору вже використано для іншого запиту.')
  }
  return { resultId: existing.resultId }
}

/**
 * Stores the result inside the business transaction. `upsert` keeps an earlier record for the
 * same key (used where a concurrent request may already have written it).
 */
export async function recordIdempotentResult(
  db: IdempotencyStore,
  scope: IdempotencyScope,
  result: { type: string; id: string; status?: number },
  { upsert = false }: { upsert?: boolean } = {},
): Promise<void> {
  const data = {
    userId: scope.userId,
    key: scope.key,
    operation: scope.operation,
    requestFingerprint: scope.fingerprint,
    resultType: result.type,
    resultId: result.id,
    responseStatus: result.status ?? 201,
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
  }
  if (upsert) {
    await db.idempotencyRecord.upsert({
      where: { userId_key_operation: { userId: scope.userId, key: scope.key, operation: scope.operation } },
      create: { id: id('idem'), ...data },
      update: {},
    })
    return
  }
  await db.idempotencyRecord.create({ data: { id: id('idem'), ...data } })
}
