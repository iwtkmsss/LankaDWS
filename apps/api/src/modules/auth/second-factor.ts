import type { AuthPrincipal } from '../../common/request-context.js'
import { decryptSecret, encryptSecret, id } from '../../common/crypto.js'
import { badRequest, unavailable } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { readSecondFactorExemption, secondFactorEnforced } from './security-policy.js'
import { generateTotpSecret, matchTotp, totpUri } from './totp.js'

/**
 * The place where a second authentication factor plugs in. The application uses the built-in
 * authenticator-app method (`TotpSecondFactorProvider`, docs/decisions.md 2026-11-27). It is
 * mandatory for everyone: a user without it is sent through enrolment before any other request.
 * An administrator may exempt one person for at most a day; there is no workspace-wide switch.
 * RADIUS may become another implementation of this interface later.
 */
export interface SecondFactorProvider {
  /** Stable identifier of the method, e.g. `none`, `totp`, `radius`. */
  readonly id: string
  /** Whether the factor is enforced at all (false only in automated test runs). */
  settings(): Promise<{ enforced: boolean }>
  /** Until when an administrator lets this person in without the factor, if at all. */
  exemptUntil(userId: string): Promise<Date | null>
  /** Whether the user has completed enrolment and must pass the factor at sign-in. */
  isEnrolled(userId: string): Promise<boolean>
  /** Begins enrolment and returns whatever the client needs to show (a secret, a link…). */
  startEnrollment(principal: AuthPrincipal): Promise<Record<string, unknown>>
  /** Completes enrolment with a first valid code; false for a wrong code. */
  confirmEnrollment(principal: AuthPrincipal, code: string): Promise<boolean>
  /** Checks a code for an enrolled user. */
  verify(principal: AuthPrincipal, code: string): Promise<boolean>
  /** Removes the user's enrolment (administrator reset); the next sign-in enrols again. */
  reset(userId: string): Promise<void>
}

/** What the user still owes before a full session: a code, an enrolment, or nothing. */
export async function requiredSecondFactor(provider: SecondFactorProvider, user: { id: string }): Promise<'CHALLENGE' | 'ENROLL' | null> {
  if (!(await provider.settings()).enforced) return null
  if (await provider.exemptUntil(user.id)) return null
  return await provider.isEnrolled(user.id) ? 'CHALLENGE' : 'ENROLL'
}

const notConfigured = () => unavailable('Двофакторна автентифікація не налаштована.')

/** A provider that never asks for a second factor; used in tests and as a reference. */
export class NoSecondFactorProvider implements SecondFactorProvider {
  readonly id = 'none'

  settings() {
    return Promise.resolve({ enforced: false })
  }

  exemptUntil(): Promise<Date | null> {
    return Promise.resolve(null)
  }

  isEnrolled(): Promise<boolean> {
    return Promise.resolve(false)
  }

  startEnrollment(): Promise<Record<string, unknown>> {
    return Promise.reject(notConfigured())
  }

  confirmEnrollment(): Promise<boolean> {
    return Promise.reject(notConfigured())
  }

  verify(): Promise<boolean> {
    return Promise.reject(notConfigured())
  }

  reset(): Promise<void> {
    return Promise.resolve()
  }
}

/** A demo installation only shows the flow: any 6-digit code is accepted. */
const demoMode = () => getConfig().VITE_DEMO_MODE === 'true'

/**
 * Authenticator-app codes (TOTP). Secrets are stored encrypted in `TotpCredential`; there are no
 * recovery codes (a lost phone is reset by an administrator). The last accepted time step per user
 * is kept in memory, so one code cannot be used twice while this API process runs.
 */
export class TotpSecondFactorProvider implements SecondFactorProvider {
  readonly id = 'totp'
  private readonly lastAcceptedStep = new Map<string, number>()

  constructor(private readonly prisma: PrismaService) {}

  settings() {
    return Promise.resolve({ enforced: secondFactorEnforced() })
  }

  exemptUntil(userId: string): Promise<Date | null> {
    return readSecondFactorExemption(this.prisma, userId)
  }

  async isEnrolled(userId: string): Promise<boolean> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId }, select: { confirmedAt: true, disabledAt: true } })
    return Boolean(credential?.confirmedAt && !credential.disabledAt)
  }

  async startEnrollment(principal: AuthPrincipal): Promise<Record<string, unknown>> {
    if (await this.isEnrolled(principal.userId)) throw badRequest('second_factor_enrolled', 'Застосунок-автентифікатор уже підключено.')
    const secret = generateTotpSecret()
    await this.prisma.totpCredential.upsert({
      where: { userId: principal.userId },
      create: { id: id('totp'), userId: principal.userId, encryptedSecret: encryptSecret(secret) },
      update: { encryptedSecret: encryptSecret(secret), confirmedAt: null, disabledAt: null },
    })
    return { secret, uri: totpUri(secret, principal.username) }
  }

  async confirmEnrollment(principal: AuthPrincipal, code: string): Promise<boolean> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId: principal.userId } })
    if (!credential) throw badRequest('second_factor_setup_missing', 'Спочатку почніть налаштування.')
    if (credential.confirmedAt) throw badRequest('second_factor_enrolled', 'Застосунок-автентифікатор уже підключено.')
    if (!this.accept(principal.userId, decryptSecret(credential.encryptedSecret), code)) return false
    await this.prisma.$transaction([
      this.prisma.totpCredential.update({ where: { id: credential.id }, data: { confirmedAt: new Date() } }),
      // Recovery codes are no longer issued; drop any left from earlier enrolments.
      this.prisma.recoveryCode.deleteMany({ where: { userId: principal.userId } }),
    ])
    return true
  }

  async verify(principal: AuthPrincipal, code: string): Promise<boolean> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId: principal.userId } })
    if (!credential?.confirmedAt || credential.disabledAt) return false
    return this.accept(principal.userId, decryptSecret(credential.encryptedSecret), code)
  }

  async reset(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ])
    this.lastAcceptedStep.delete(userId)
  }

  private accept(userId: string, secret: string, code: string): boolean {
    if (demoMode()) return /^\d{6}$/u.test(code)
    const step = matchTotp(secret, code)
    if (step === null) return false
    const last = this.lastAcceptedStep.get(userId)
    if (last !== undefined && step <= last) return false
    this.lastAcceptedStep.set(userId, step)
    return true
  }
}

const providers = new WeakMap<object, SecondFactorProvider>()

/**
 * The provider the application uses: one instance per Prisma client, so the guard and the auth
 * service share the replay protection. A plain function rather than a Nest provider: constructor
 * parameter decorators break dependency injection when scripts run under tsx.
 */
export function secondFactorProvider(prisma: PrismaService): SecondFactorProvider {
  let provider = providers.get(prisma)
  if (!provider) {
    provider = new TotpSecondFactorProvider(prisma)
    providers.set(prisma, provider)
  }
  return provider
}
