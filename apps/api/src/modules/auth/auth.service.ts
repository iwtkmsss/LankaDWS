import { Injectable } from '@nestjs/common'
import type { Request, Response } from 'express'
import * as OTPAuth from 'otpauth'
import type { LoginInput, LoginResult, PrincipalView, SessionView } from '@bert-crm/contracts'
import { decryptSecret, encryptSecret, fingerprint, hashPassword, id, randomToken, verifyPassword } from '../../common/crypto.js'
import { badRequest, forbidden, notFound, rateLimited, unauthorized } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { normalizeUserSearchValue } from '../../common/user-search.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { assertPasswordPolicy } from './password-policy.js'
import { CapabilitiesService } from '../authorization/capabilities.service.js'

interface SessionTarget { id: string; authorizationVersion: number }

@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(randomToken())

  constructor(private readonly prisma: PrismaService, private readonly capabilities: CapabilitiesService) {}

  async login(input: LoginInput, request: Request, response: Response): Promise<LoginResult> {
    const normalized = input.username.trim().toLowerCase()
    const usernameFingerprint = fingerprint(normalized, 'login-username')
    const ipHash = request.ip ? fingerprint(request.ip, 'login-ip') : null
    const since = new Date(Date.now() - getConfig().LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000)
    const failed = await this.prisma.loginAttempt.count({ where: { createdAt: { gte: since }, result: 'FAILURE', OR: [{ usernameFingerprint }, ...(ipHash ? [{ ipHash }] : [])] } })
    if (failed >= getConfig().LOGIN_RATE_LIMIT_MAX) throw rateLimited()

    const user = await this.prisma.user.findUnique({
      where: { workspaceId_normalizedUsername: { workspaceId: await this.activeWorkspaceId(), normalizedUsername: normalized } },
      include: { passwordCredential: true, totpCredential: true },
    })

    let permanentValid = false
    let temporaryValid = false
    let temporaryId: string | undefined
    if (user?.passwordCredential) permanentValid = await verifyPassword(user.passwordCredential.passwordHash, input.password)
    if (user) {
      const temporary = await this.prisma.temporaryCredential.findFirst({
        where: { userId: user.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      })
      if (temporary) {
        temporaryValid = await verifyPassword(temporary.secretHash, input.password)
        temporaryId = temporary.id
      }
    } else {
      await verifyPassword(await this.dummyHash, input.password)
    }

    const validState = user?.isActive === true
    if (!user || !validState || (!permanentValid && !temporaryValid)) {
      await this.recordLogin(usernameFingerprint, ipHash, user?.id, 'FAILURE', 'invalid_credentials')
      throw unauthorized('invalid_credentials')
    }
    await this.recordLogin(usernameFingerprint, ipHash, user.id, 'SUCCESS', temporaryValid ? 'temporary' : 'password')

    if (temporaryValid) {
      await this.createSession(user, request, response, 0, true)
      response.cookie('bert_temp_credential', temporaryId ?? '', this.cookieOptions(true))
      return { nextStep: 'FIRST_LOGIN', csrfToken: response.locals.csrfToken as string }
    }
    if (user.totpCredential?.confirmedAt) {
      await this.createSession(user, request, response, 1, true)
      return { nextStep: 'TWO_FACTOR', csrfToken: response.locals.csrfToken as string }
    }
    if (user.mustEnroll2FA) {
      await this.createSession(user, request, response, 1, true)
      return { nextStep: 'TWO_FACTOR_SETUP', csrfToken: response.locals.csrfToken as string }
    }
    await this.createSession(user, request, response, 1, false)
    return { nextStep: 'AUTHENTICATED', csrfToken: response.locals.csrfToken as string }
  }

  async completeFirstLogin(principal: AuthPrincipal, newPassword: string, confirmation: string, response: Response): Promise<void> {
    if (!principal.restricted || newPassword !== confirmation) throw badRequest('password_confirmation', 'Паролі не збігаються.')
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId } })
    if (!user) throw notFound()
    assertPasswordPolicy(newPassword, user.normalizedUsername, user.mustEnroll2FA)
    const passwordHash = await hashPassword(newPassword)
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordCredential.upsert({
        where: { userId: user.id },
        create: { id: id('pwd'), userId: user.id, passwordHash },
        update: { passwordHash, credentialVersion: { increment: 1 }, changedAt: new Date() },
      })
      await tx.temporaryCredential.updateMany({ where: { userId: user.id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: new Date() } })
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'first_login_completed' } })
      await tx.credentialEvent.create({ data: { id: id('cev'), userId: user.id, actorId: user.id, type: 'first_login_password_changed', result: 'SUCCESS', correlationId: id('corr') } })
    })
    this.clearCookies(response)
  }

  async startTotpSetup(principal: AuthPrincipal): Promise<{ secret: string; uri: string }> {
    const secret = new OTPAuth.Secret({ size: 20 })
    const totp = this.totp(secret.base32, principal.username)
    await this.prisma.totpCredential.upsert({
      where: { userId: principal.userId },
      create: { id: id('totp'), userId: principal.userId, encryptedSecret: encryptSecret(secret.base32) },
      update: { encryptedSecret: encryptSecret(secret.base32), confirmedAt: null, disabledAt: null },
    })
    return { secret: secret.base32, uri: totp.toString() }
  }

  async confirmTotp(principal: AuthPrincipal, code: string, request: Request, response: Response): Promise<{ recoveryCodes: string[] }> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId: principal.userId } })
    if (!credential || this.totpValidate(decryptSecret(credential.encryptedSecret), principal.username, code) === null) throw badRequest('invalid_totp', 'Код не підтверджено.')
    const recoveryCodes = Array.from({ length: 10 }, () => randomToken(9))
    await this.prisma.$transaction(async (tx) => {
      await tx.totpCredential.update({ where: { id: credential.id }, data: { confirmedAt: new Date() } })
      await tx.recoveryCode.deleteMany({ where: { userId: principal.userId } })
      await tx.recoveryCode.createMany({ data: recoveryCodes.map((code) => ({ id: id('rcv'), userId: principal.userId, codeHash: fingerprint(code, 'recovery') })) })
      await tx.user.update({ where: { id: principal.userId }, data: { mustEnroll2FA: false } })
    })
    await this.rotateSession(principal, request, response, 2, false)
    return { recoveryCodes }
  }

  async challengeTotp(principal: AuthPrincipal, code: string, request: Request, response: Response): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId }, include: { totpCredential: true } })
    if (!user?.totpCredential?.confirmedAt || this.totpValidate(decryptSecret(user.totpCredential.encryptedSecret), user.username, code) === null) throw unauthorized('invalid_totp')
    await this.rotateSession(principal, request, response, 2, false)
    return { nextStep: 'AUTHENTICATED', csrfToken: response.locals.csrfToken as string }
  }

  async useRecoveryCode(principal: AuthPrincipal, code: string, request: Request, response: Response): Promise<LoginResult> {
    const record = await this.prisma.recoveryCode.findFirst({ where: { userId: principal.userId, codeHash: fingerprint(code, 'recovery'), consumedAt: null } })
    if (!record) throw unauthorized('invalid_recovery_code')
    await this.prisma.recoveryCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } })
    await this.rotateSession(principal, request, response, 2, false)
    return { nextStep: 'AUTHENTICATED', csrfToken: response.locals.csrfToken as string }
  }

  async reauthenticate(principal: AuthPrincipal, password: string, code?: string): Promise<{ challengeId: string; expiresAt: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId }, include: { passwordCredential: true, totpCredential: true } })
    if (!user?.passwordCredential || !(await verifyPassword(user.passwordCredential.passwordHash, password))) throw unauthorized('reauth_failed')
    if (user.totpCredential?.confirmedAt && (!code || this.totpValidate(decryptSecret(user.totpCredential.encryptedSecret), user.username, code) === null)) throw unauthorized('reauth_failed')
    const expiresAt = new Date(Date.now() + getConfig().REAUTH_MINUTES * 60_000)
    const challengeId = id('reauth')
    await this.prisma.reauthChallenge.create({ data: { id: challengeId, sessionId: principal.sessionId, purpose: 'critical_action', assurance: user.totpCredential?.confirmedAt ? 2 : 1, expiresAt, satisfiedAt: new Date() } })
    return { challengeId, expiresAt: expiresAt.toISOString() }
  }

  async changePassword(principal: AuthPrincipal, input: { currentPassword: string; newPassword: string; confirmation: string }): Promise<void> {
    if (input.newPassword !== input.confirmation) throw badRequest('password_confirmation', 'Паролі не збігаються.')
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId }, include: { passwordCredential: true } })
    if (!user?.passwordCredential || !(await verifyPassword(user.passwordCredential.passwordHash, input.currentPassword))) throw unauthorized('current_password_invalid')
    assertPasswordPolicy(input.newPassword, user.normalizedUsername, user.mustEnroll2FA)
    if (await verifyPassword(user.passwordCredential.passwordHash, input.newPassword)) throw badRequest('password_reuse', 'Новий пароль має відрізнятися від поточного.')
    const passwordHash = await hashPassword(input.newPassword)
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordCredential.update({ where: { userId: user.id }, data: { passwordHash, credentialVersion: { increment: 1 }, changedAt: new Date() } })
      await tx.userSession.updateMany({ where: { userId: user.id, id: { not: principal.sessionId }, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_changed' } })
      await tx.credentialEvent.create({ data: { id: id('cev'), userId: user.id, actorId: user.id, type: 'password_changed', result: 'SUCCESS', correlationId: id('corr') } })
    })
  }

  async updateProfile(principal: AuthPrincipal, input: { displayName: string; jobTitle: string; contactEmail: string | null; timezone: string; locale: 'uk-UA' | 'en-US' }) {
    try { Intl.DateTimeFormat('uk-UA', { timeZone: input.timezone }).format(new Date()) } catch { throw badRequest('timezone_invalid') }
    const user = await this.prisma.user.update({
      where: { id: principal.userId },
      data: {
        ...input,
        normalizedDisplayName: normalizeUserSearchValue(input.displayName),
      },
      select: { displayName: true, jobTitle: true, contactEmail: true, timezone: true, locale: true },
    })
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: principal.primaryCompanyId, actorType: 'USER', actorId: principal.userId, action: 'profile.updated', entityType: 'USER', entityId: principal.userId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    return user
  }

  async updateAvatar(principal: AuthPrincipal, fileId: string) {
    await this.prisma.user.update({ where: { id: principal.userId }, data: { avatarAsset: fileId } })
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: principal.primaryCompanyId || null, actorType: 'USER', actorId: principal.userId, action: 'profile.avatar_updated', entityType: 'USER', entityId: principal.userId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    return { avatarAsset: `/api/v1/me/avatar/${fileId}` }
  }

  async removeAvatar(principal: AuthPrincipal) {
    await this.prisma.user.update({ where: { id: principal.userId }, data: { avatarAsset: null } })
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: principal.primaryCompanyId || null, actorType: 'USER', actorId: principal.userId, action: 'profile.avatar_removed', entityType: 'USER', entityId: principal.userId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    return { avatarAsset: null }
  }

  async notificationPreferences(principal: AuthPrincipal) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId: principal.userId, category: 'ALL' } })
    const email = rows.find((row) => row.channel === 'EMAIL')
    const app = rows.find((row) => row.channel === 'IN_APP')
    const quiet = JSON.parse(email?.quietJson ?? app?.quietJson ?? '{}') as { start?: string; end?: string }
    return { emailEnabled: email?.enabled ?? true, inAppEnabled: true, digest: email?.digest ?? 'DAILY', quietStart: quiet.start ?? '20:00', quietEnd: quiet.end ?? '08:00' }
  }

  async updateNotificationPreferences(principal: AuthPrincipal, input: { emailEnabled: boolean; inAppEnabled: true; digest: 'IMMEDIATE' | 'DAILY' | 'WEEKLY'; quietStart: string; quietEnd: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId }, select: { timezone: true } })
    if (!user) throw notFound()
    const quietJson = JSON.stringify({ start: input.quietStart, end: input.quietEnd, timezone: user.timezone })
    await this.prisma.$transaction([
      this.prisma.notificationPreference.upsert({ where: { userId_category_channel: { userId: principal.userId, category: 'ALL', channel: 'EMAIL' } }, create: { id: id('npf'), userId: principal.userId, category: 'ALL', channel: 'EMAIL', enabled: input.emailEnabled, digest: input.digest, quietJson }, update: { enabled: input.emailEnabled, digest: input.digest, quietJson, version: { increment: 1 } } }),
      this.prisma.notificationPreference.upsert({ where: { userId_category_channel: { userId: principal.userId, category: 'ALL', channel: 'IN_APP' } }, create: { id: id('npf'), userId: principal.userId, category: 'ALL', channel: 'IN_APP', enabled: true, digest: 'IMMEDIATE', quietJson }, update: { enabled: true, digest: 'IMMEDIATE', quietJson, version: { increment: 1 } } }),
    ])
    return this.notificationPreferences(principal)
  }

  async assertRecentReauth(principal: AuthPrincipal, challengeId: string | undefined): Promise<void> {
    if (!challengeId) throw forbidden('Потрібне повторне підтвердження особи.')
    const challenge = await this.prisma.reauthChallenge.findFirst({ where: { id: challengeId, sessionId: principal.sessionId, satisfiedAt: { not: null }, expiresAt: { gt: new Date() } } })
    if (!challenge) throw forbidden('Повторне підтвердження прострочене або не відповідає сесії.')
  }

  async me(principal: AuthPrincipal, csrfToken: string): Promise<PrincipalView> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      include: { primaryCompany: true },
    })
    if (!user) throw notFound()
    const capabilities = user.primaryCompanyId
      ? await this.capabilities.forOrganization(user.primaryCompanyId)
      : await this.capabilities.forOrganizations(principal.allowedCompanyIds)
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      jobTitle: user.jobTitle,
      avatarAsset: user.avatarAsset?.startsWith('file_') ? `/api/v1/me/avatar/${user.avatarAsset}` : user.avatarAsset,
      company: user.primaryCompany ? { id: user.primaryCompany.id, name: user.primaryCompany.displayName, slug: user.primaryCompany.code, isActive: user.primaryCompany.isActive, timezone: user.primaryCompany.timezone } : null,
      accountType: user.accountType,
      contactEmail: user.contactEmail,
      timezone: user.timezone,
      locale: user.locale as 'uk-UA' | 'en-US',
      capabilities,
      csrfToken,
      mustEnroll2FA: user.mustEnroll2FA,
    }
  }

  async sessions(principal: AuthPrincipal): Promise<SessionView[]> {
    const sessions = await this.prisma.userSession.findMany({ where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } })
    return sessions.map((session) => ({ id: session.id, deviceLabel: session.deviceLabel, createdAt: session.createdAt.toISOString(), lastSeenAt: session.lastSeenAt.toISOString(), expiresAt: session.expiresAt.toISOString(), current: session.id === principal.sessionId }))
  }

  async revokeSession(principal: AuthPrincipal, sessionId: string): Promise<void> {
    const result = await this.prisma.userSession.updateMany({ where: { id: sessionId, userId: principal.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user_revoked' } })
    if (result.count === 0) throw notFound()
  }

  async revokeOthers(principal: AuthPrincipal): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { userId: principal.userId, id: { not: principal.sessionId }, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user_revoked_others' } })
  }

  async logout(principal: AuthPrincipal, response: Response): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { id: principal.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'logout' } })
    this.clearCookies(response)
  }

  private async activeWorkspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!workspace) throw unauthorized('invalid_credentials')
    return workspace.id
  }

  private async recordLogin(usernameFingerprint: string, ipHash: string | null, userId: string | undefined, result: string, reasonCode: string): Promise<void> {
    await this.prisma.loginAttempt.create({ data: { id: id('login'), usernameFingerprint, ipHash, resolvedUserId: userId, result, reasonCode } })
  }

  private async createSession(user: SessionTarget, request: Request, response: Response, assurance: number, restricted: boolean): Promise<void> {
    const token = randomToken()
    const csrfToken = randomToken(24)
    const expiresAt = new Date(Date.now() + getConfig().SESSION_ABSOLUTE_HOURS * 3_600_000)
    await this.prisma.userSession.create({ data: {
      id: id('ses'), sessionHash: fingerprint(token, 'session'), userId: user.id, authAssurance: assurance,
      authorizationVersion: user.authorizationVersion, csrfHash: fingerprint(csrfToken, 'csrf'),
      deviceLabel: this.deviceLabel(request), userAgentHash: request.get('user-agent') ? fingerprint(request.get('user-agent') ?? '', 'ua') : null,
      ipHash: request.ip ? fingerprint(request.ip, 'session-ip') : null, expiresAt,
      revokeReason: restricted ? 'restricted' : null,
    } })
    response.cookie(getConfig().SESSION_COOKIE_NAME, token, this.cookieOptions(true, expiresAt))
    response.cookie('bert_csrf', csrfToken, this.cookieOptions(false, expiresAt))
    response.locals.csrfToken = csrfToken
  }

  private async rotateSession(principal: AuthPrincipal, request: Request, response: Response, assurance: number, restricted: boolean): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { id: principal.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'rotated' } })
    await this.createSession({ id: principal.userId, authorizationVersion: principal.authorizationVersion }, request, response, assurance, restricted)
  }

  private cookieOptions(httpOnly: boolean, expires?: Date) {
    return { httpOnly, secure: getConfig().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', ...(expires ? { expires } : {}) }
  }

  private clearCookies(response: Response): void {
    response.clearCookie(getConfig().SESSION_COOKIE_NAME, this.cookieOptions(true))
    response.clearCookie('bert_csrf', this.cookieOptions(false))
    response.clearCookie('bert_temp_credential', this.cookieOptions(true))
  }

  private deviceLabel(request: Request): string {
    const ua = request.get('user-agent') ?? 'Невідомий пристрій'
    return ua.slice(0, 120)
  }

  private totp(secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({ issuer: 'BERT CRM', label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) })
  }

  private totpValidate(secret: string, label: string, token: string): number | null {
    return this.totp(secret, label).validate({ token, window: 1 })
  }
}
