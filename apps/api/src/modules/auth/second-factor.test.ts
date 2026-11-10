import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'
import { NoSecondFactorProvider, type SecondFactorProvider } from './second-factor.js'

const principal = { userId: 'usr', sessionId: 'ses' } as AuthPrincipal

function enabledProvider(enrolled: boolean): SecondFactorProvider {
  return {
    id: 'test', enabled: true,
    isEnrolled: vi.fn().mockResolvedValue(enrolled),
    startEnrollment: vi.fn(), confirmEnrollment: vi.fn(), verify: vi.fn(), useRecoveryCode: vi.fn(),
  }
}

describe('second factor placeholder', () => {
  it('asks for no second factor while no method is configured, even when enrolment is required', async () => {
    const service = new AuthService({} as PrismaService, {} as never)
    await expect(service.requiresSecondFactor({ id: 'usr', mustEnroll2FA: true })).resolves.toBeNull()
  })

  it('answers every second-factor action with "not configured"', async () => {
    const provider = new NoSecondFactorProvider()
    expect(provider.enabled).toBe(false)
    await expect(provider.isEnrolled()).resolves.toBe(false)
    for (const action of [provider.startEnrollment(), provider.confirmEnrollment(), provider.verify(), provider.useRecoveryCode()]) {
      await expect(action).rejects.toMatchObject({ status: 503 })
    }
    const service = new AuthService({} as PrismaService, {} as never)
    await expect(service.startSecondFactorEnrollment(principal)).rejects.toMatchObject({ status: 503 })
  })

  it('requires the factor from enrolled users and enrolment from obliged users once a method is configured', async () => {
    const enrolled = new AuthService({} as PrismaService, {} as never)
    enrolled.secondFactor = enabledProvider(true)
    await expect(enrolled.requiresSecondFactor({ id: 'usr', mustEnroll2FA: false })).resolves.toBe('CHALLENGE')
    const obliged = new AuthService({} as PrismaService, {} as never)
    obliged.secondFactor = enabledProvider(false)
    await expect(obliged.requiresSecondFactor({ id: 'usr', mustEnroll2FA: true })).resolves.toBe('ENROLL')
    await expect(obliged.requiresSecondFactor({ id: 'usr', mustEnroll2FA: false })).resolves.toBeNull()
  })
})
