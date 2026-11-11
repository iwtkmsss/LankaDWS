import { describe, expect, it, vi } from 'vitest'
import { recordAudit } from './audit.js'
import { currentCorrelationId, runWithCorrelationId } from './correlation.js'
import type { AuthPrincipal } from './request-context.js'

const principal = { userId: 'usr_1', workspaceId: 'ws_1' } as AuthPrincipal

function fakeDb() {
  const create = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args))
  return { db: { auditEvent: { create } } as never, create }
}

describe('recordAudit', () => {
  it('applies defaults for a user principal', async () => {
    const { db, create } = fakeDb()
    await recordAudit(db, principal, { action: 'x.did', entityType: 'X', entityId: 'x_1' })
    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      workspaceId: 'ws_1', actorType: 'USER', actorId: 'usr_1', action: 'x.did', entityType: 'X', entityId: 'x_1',
      result: 'SUCCESS', risk: 'NORMAL',
    })
    expect(data.id).toMatch(/^aud_/)
    expect(data.safeDiffJson).toBeUndefined()
    expect(data.companyId).toBeUndefined()
  })

  it('serializes safeDiff and passes explicit overrides through', async () => {
    const { db, create } = fakeDb()
    await recordAudit(db, principal, {
      action: 'x.did', entityType: 'X', entityId: 'x_1', companyId: null, result: 'QUEUED', risk: 'HIGH',
      safeDiff: { a: 1 }, reasonCode: 'why',
    })
    expect(create.mock.calls[0][0].data).toMatchObject({
      companyId: null, result: 'QUEUED', risk: 'HIGH', safeDiffJson: '{"a":1}', reasonCode: 'why',
    })
  })

  it('records a system actor without a principal and requires a workspace', async () => {
    const { db, create } = fakeDb()
    await recordAudit(db, null, { workspaceId: 'ws_9', action: 'job.ran', entityType: 'JOB', entityId: 'j_1' })
    expect(create.mock.calls[0][0].data).toMatchObject({ workspaceId: 'ws_9', actorType: 'SYSTEM' })
    expect(create.mock.calls[0][0].data.actorId).toBeUndefined()
    expect(() => recordAudit(db, null, { action: 'a', entityType: 'B', entityId: 'c' })).toThrow(/workspaceId/)
  })

  it('writes through the client it is given (transaction client)', async () => {
    const outer = fakeDb()
    const tx = fakeDb()
    await recordAudit(tx.db, principal, { action: 'a', entityType: 'B', entityId: 'c' })
    expect(tx.create).toHaveBeenCalledTimes(1)
    expect(outer.create).not.toHaveBeenCalled()
  })

  it('returns the unawaited client promise for array-form transactions', () => {
    const sentinel = { sentinel: true }
    const db = { auditEvent: { create: vi.fn(() => sentinel) } } as never
    expect(recordAudit(db, principal, { action: 'a', entityType: 'B', entityId: 'c' })).toBe(sentinel)
  })

  it('uses the request correlation ID across async hops', async () => {
    const { db, create } = fakeDb()
    await runWithCorrelationId('req-correlation-1', async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 1))
      await recordAudit(db, principal, { action: 'a', entityType: 'B', entityId: 'c' })
    })
    expect(create.mock.calls[0][0].data.correlationId).toBe('req-correlation-1')
    expect(currentCorrelationId()).toBeUndefined()
  })

  it('falls back to a fresh corr ID outside a request', async () => {
    const { db, create } = fakeDb()
    await recordAudit(db, principal, { action: 'a', entityType: 'B', entityId: 'c' })
    await recordAudit(db, principal, { action: 'a', entityType: 'B', entityId: 'c' })
    const [first, second] = create.mock.calls.map((call) => call[0].data.correlationId)
    expect(first).toMatch(/^corr_/)
    expect(second).not.toBe(first)
  })
})
