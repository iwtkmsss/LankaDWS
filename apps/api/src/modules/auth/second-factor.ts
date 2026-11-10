import type { AuthPrincipal } from '../../common/request-context.js'
import { unavailable } from '../../common/errors.js'

/**
 * The place where a second authentication factor plugs in. No method has been chosen yet
 * (see docs/decisions.md, 2026-11-10), so the application runs with `NoSecondFactorProvider`:
 * sign-in needs only the password and every 2FA endpoint answers "not configured".
 *
 * To add the chosen method (an authenticator app, a RADIUS server, …): implement this
 * interface and return it from `secondFactorProvider` below, with `enabled` set.
 * `AuthService` and `SessionAuthGuard` then require the factor for enrolled users and for
 * users an administrator obliged to enrol (`User.mustEnroll2FA`).
 */
export interface SecondFactorProvider {
  /** Stable identifier of the method, e.g. `none`, `totp`, `radius`. */
  readonly id: string
  /** False while no method is configured; nothing below is called then. */
  readonly enabled: boolean
  /** Whether the user has completed enrolment and must pass the factor at sign-in. */
  isEnrolled(userId: string): Promise<boolean>
  /** Begins enrolment and returns whatever the client needs to show (a QR code, instructions…). */
  startEnrollment(principal: AuthPrincipal): Promise<Record<string, unknown>>
  /** Completes enrolment with a first valid code and returns one-time recovery codes. */
  confirmEnrollment(principal: AuthPrincipal, code: string): Promise<{ recoveryCodes: string[] }>
  /** Checks a code for an enrolled user. */
  verify(principal: AuthPrincipal, code: string): Promise<boolean>
  /** Consumes a one-time recovery code; true when it was valid and unused. */
  useRecoveryCode(principal: AuthPrincipal, code: string): Promise<boolean>
}

const notConfigured = () => unavailable('Двофакторна автентифікація ще не налаштована.')

/** The placeholder used until a second-factor method is chosen. */
export class NoSecondFactorProvider implements SecondFactorProvider {
  readonly id = 'none'
  readonly enabled = false

  isEnrolled(): Promise<boolean> {
    return Promise.resolve(false)
  }

  startEnrollment(): Promise<Record<string, unknown>> {
    return Promise.reject(notConfigured())
  }

  confirmEnrollment(): Promise<{ recoveryCodes: string[] }> {
    return Promise.reject(notConfigured())
  }

  verify(): Promise<boolean> {
    return Promise.reject(notConfigured())
  }

  useRecoveryCode(): Promise<boolean> {
    return Promise.reject(notConfigured())
  }
}

/**
 * The provider the application uses. It is a plain module value rather than a Nest provider:
 * constructor parameter decorators break dependency injection when scripts run under tsx.
 */
export const secondFactorProvider: SecondFactorProvider = new NoSecondFactorProvider()
