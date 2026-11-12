import { describe, expect, it, vi } from 'vitest'
import type { Request } from 'express'
import { getConfig } from '../../config/config.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'

type Where = { usernameFingerprint?: string; ipHash?: string | null }

/** Runs a login whose failure counts are decided per throttling tier; the lookup throws to prove whether the gate was passed. */
async function attempt(counts: { pair: number; ip: number; username: number }) {
  const count = vi.fn(({ where }: { where: Where }) => {
    if (where.usernameFingerprint && where.ipHash) return Promise.resolve(counts.pair)
    if (where.ipHash) return Promise.resolve(counts.ip)
    return Promise.resolve(counts.username)
  })
  const reachedLookup = new Error('lookup-reached')
  const prisma = {
    loginAttempt: { count },
    workspace: { findFirst: vi.fn().mockRejectedValue(reachedLookup) },
    user: { findUnique: vi.fn().mockRejectedValue(reachedLookup) },
  } as unknown as PrismaService
  const service = new AuthService(prisma, {} as never)
  const request = { ip: '10.0.0.1', get: () => undefined } as unknown as Request
  return service.login({ username: 'Maria', password: 'x' }, request, {} as never).then(
    () => 'ok',
    (error: unknown) => (error === reachedLookup ? 'passed' : (error as { code?: string }).code),
  )
}

describe('login throttling tiers', () => {
  const max = getConfig().LOGIN_RATE_LIMIT_MAX

  it('blocks the username+IP pair at the configured maximum', async () => {
    expect(await attempt({ pair: max, ip: max, username: max })).toBe('rate_limited')
    expect(await attempt({ pair: max - 1, ip: max - 1, username: max - 1 })).toBe('passed')
  })

  it('does not let one IP lock an account for everyone else: IP-wide and username-wide limits are higher', async () => {
    expect(await attempt({ pair: 0, ip: max, username: max })).toBe('passed')
    expect(await attempt({ pair: 0, ip: max * 4, username: 0 })).toBe('rate_limited')
    expect(await attempt({ pair: 0, ip: 0, username: max * 3 })).toBe('rate_limited')
    expect(await attempt({ pair: 0, ip: max * 4 - 1, username: max * 3 - 1 })).toBe('passed')
  })
})
