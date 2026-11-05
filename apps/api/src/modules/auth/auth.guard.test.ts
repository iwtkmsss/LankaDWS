import { describe, expect, it, vi } from 'vitest'
import { SessionAuthGuard } from './auth.guard.js'
import { getConfig } from '../../config/config.js'

describe('SessionAuthGuard inactive accounts', () => {
  it.each([false, true])('rejects inactive users even when revokedAt is set: %s', async (revoked) => {
    const guard = new SessionAuthGuard({ getAllAndOverride: () => false } as never, {
      userSession: { findUnique: vi.fn().mockResolvedValue({
        revokedAt: revoked ? new Date() : null,
        expiresAt: new Date(Date.now() + 60_000), user: { isActive: false },
      }) },
    } as never)
    const context = {
      getHandler: vi.fn(), getClass: vi.fn(),
      switchToHttp: () => ({ getRequest: () => ({ cookies: { [getConfig().SESSION_COOKIE_NAME]: 'token' } }) }),
    }
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({ status: 401 })
  })
})
