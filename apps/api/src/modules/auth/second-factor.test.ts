import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'
import { NoSecondFactorProvider, requiredSecondFactor, TotpSecondFactorProvider, type SecondFactorProvider } from './second-factor.js'
import { invalidateSecurityPolicyCache } from './security-policy.js'
import { resetConfigForTests } from '../../config/config.js'
import { encryptSecret } from '../../common/crypto.js'
import { base32Decode, base32Encode, hotp, matchTotp, totpUri } from './totp.js'

const principal = { userId: 'usr', sessionId: 'ses', username: 'maria' } as AuthPrincipal

function provider(enrolled: boolean, { enforced = true, exemptUntil = null as Date | null } = {}): SecondFactorProvider {
  return {
    id: 'test',
    settings: vi.fn().mockResolvedValue({ enforced }),
    exemptUntil: vi.fn().mockResolvedValue(exemptUntil),
    isEnrolled: vi.fn().mockResolvedValue(enrolled),
    startEnrollment: vi.fn(), confirmEnrollment: vi.fn(), verify: vi.fn(), reset: vi.fn(),
  }
}

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 key "12345678901234567890", truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  it.each([[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']])('matches the reference code at %i s', (seconds, code) => {
    expect(hotp(base32Decode(secret), Math.floor(seconds / 30))).toBe(code)
    expect(matchTotp(secret, code, seconds * 1000)).toBe(Math.floor(seconds / 30))
  })

  it('tolerates one step of clock drift and rejects anything further or malformed', () => {
    const now = 1111111109 * 1000
    expect(matchTotp(secret, '081804', now + 30_000)).not.toBeNull()
    expect(matchTotp(secret, '081804', now - 30_000)).not.toBeNull()
    expect(matchTotp(secret, '081804', now + 90_000)).toBeNull()
    expect(matchTotp(secret, '81804', now)).toBeNull()
    expect(matchTotp(secret, 'abcdef', now)).toBeNull()
  })

  it('round-trips base32 and builds an authenticator link', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253])
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
    expect(totpUri('JBSWY3DPEHPK3PXP', 'maria')).toBe('otpauth://totp/LankaDWS:maria?secret=JBSWY3DPEHPK3PXP&issuer=LankaDWS&algorithm=SHA1&digits=6&period=30')
  })
})

describe('second factor requirement', () => {
  const user = { id: 'usr' }

  it('makes everyone enrol first and then pass a code', async () => {
    await expect(requiredSecondFactor(provider(false), user)).resolves.toBe('ENROLL')
    await expect(requiredSecondFactor(provider(true), user)).resolves.toBe('CHALLENGE')
  })

  it('asks for nothing while a personal exemption runs (or in test runs)', async () => {
    await expect(requiredSecondFactor(provider(true, { enforced: false }), user)).resolves.toBeNull()
    await expect(requiredSecondFactor(provider(false, { exemptUntil: new Date(Date.now() + 60_000) }), user)).resolves.toBeNull()
    await expect(requiredSecondFactor(new NoSecondFactorProvider(), user)).resolves.toBeNull()
  })

  it('lets AuthService use an injected provider', async () => {
    const service = new AuthService({} as PrismaService, {} as never)
    service.secondFactor = provider(true)
    await expect(service.requiresSecondFactor(user)).resolves.toBe('CHALLENGE')
  })

  it('answers every action of the placeholder with "not configured"', async () => {
    const placeholder = new NoSecondFactorProvider()
    for (const action of [placeholder.startEnrollment(), placeholder.confirmEnrollment(), placeholder.verify()]) {
      await expect(action).rejects.toMatchObject({ status: 503 })
    }
  })
})

describe('TotpSecondFactorProvider', () => {
  beforeEach(() => { invalidateSecurityPolicyCache(); upsert.mockClear() })

  const upsert = vi.fn().mockResolvedValue({})
  function prismaWith(policy: object | null, credential: Record<string, unknown> | null = null) {
    return {
      systemSetting: { findFirst: vi.fn().mockResolvedValue(policy ? { valueJson: JSON.stringify(policy), version: 1, effectiveAt: new Date() } : null) },
      totpCredential: { findUnique: vi.fn().mockResolvedValue(credential), upsert },
      recoveryCode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService
  }

  it('is always enforced outside automated test runs', async () => {
    await expect(new TotpSecondFactorProvider(prismaWith(null)).settings()).resolves.toEqual({ enforced: true })
  })

  it('starts enrolment with a fresh secret', async () => {
    const prisma = prismaWith(null)
    const totp = new TotpSecondFactorProvider(prisma)
    const result = await totp.startEnrollment(principal) as { secret: string; uri: string }
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(result.uri).toContain(`secret=${result.secret}`)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it('counts an unconfirmed or disabled credential as not enrolled', async () => {
    await expect(new TotpSecondFactorProvider(prismaWith(null, { confirmedAt: null, disabledAt: null })).isEnrolled('usr')).resolves.toBe(false)
    await expect(new TotpSecondFactorProvider(prismaWith(null, { confirmedAt: new Date(), disabledAt: new Date() })).isEnrolled('usr')).resolves.toBe(false)
    await expect(new TotpSecondFactorProvider(prismaWith(null, { confirmedAt: new Date(), disabledAt: null })).isEnrolled('usr')).resolves.toBe(true)
  })


  it('accepts any 6-digit code in a demo installation only', async () => {
    const credential = { confirmedAt: new Date(), disabledAt: null, encryptedSecret: encryptSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP') }
    try {
      vi.stubEnv('VITE_DEMO_MODE', 'true')
      resetConfigForTests()
      const demo = new TotpSecondFactorProvider(prismaWith(null, credential))
      await expect(demo.verify(principal, '123456')).resolves.toBe(true)
      await expect(demo.verify(principal, '123456')).resolves.toBe(true)
      await expect(demo.verify(principal, '12345')).resolves.toBe(false)
      vi.stubEnv('VITE_DEMO_MODE', 'false')
      resetConfigForTests()
      await expect(new TotpSecondFactorProvider(prismaWith(null, credential)).verify(principal, '123456')).resolves.toBe(false)
    } finally {
      vi.unstubAllEnvs()
      resetConfigForTests()
    }
  })
})
