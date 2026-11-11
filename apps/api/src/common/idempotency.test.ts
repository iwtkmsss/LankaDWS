import { describe, expect, it, vi } from 'vitest'
import { assertIdempotencyKey, findIdempotentResult, recordIdempotentResult } from './idempotency.js'

const scope = { userId: 'usr', key: 'key-1', operation: 'task.create', fingerprint: 'body-a' }

describe('shared idempotency', () => {
  it('returns the stored result for the same request and rejects a reused key', async () => {
    const findUnique = vi.fn().mockResolvedValue({ requestFingerprint: 'body-a', resultId: 'tsk_1' })
    const db = { idempotencyRecord: { findUnique } } as never
    await expect(findIdempotentResult(db, scope)).resolves.toEqual({ resultId: 'tsk_1' })
    await expect(findIdempotentResult(db, { ...scope, fingerprint: 'body-b' })).rejects.toMatchObject({ status: 409 })
    findUnique.mockResolvedValue(null)
    await expect(findIdempotentResult(db, scope)).resolves.toBeNull()
  })

  it('records a result for a day and keeps an earlier record when upserting', async () => {
    const create = vi.fn()
    const upsert = vi.fn()
    const db = { idempotencyRecord: { create, upsert } } as never
    await recordIdempotentResult(db, scope, { type: 'TASK', id: 'tsk_1' })
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'usr', key: 'key-1', operation: 'task.create', requestFingerprint: 'body-a',
      resultType: 'TASK', resultId: 'tsk_1', responseStatus: 201, expiresAt: expect.any(Date) as Date,
    }) as Record<string, unknown> })
    await recordIdempotentResult(db, scope, { type: 'TASK', id: 'tsk_1', status: 200 }, { upsert: true })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }))
  })

  it('requires a bounded key', () => {
    expect(() => assertIdempotencyKey(undefined)).toThrow()
    expect(() => assertIdempotencyKey('x'.repeat(201))).toThrow()
    expect(() => assertIdempotencyKey('ok')).not.toThrow()
  })
})
