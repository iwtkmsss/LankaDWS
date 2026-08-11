import { Injectable } from '@nestjs/common'
import {
  allOrganizationCapabilityCodes,
  usernamePattern,
  type OrganizationCapabilityCode,
  type UpdateOrganizationCapability,
} from '@bert-crm/contracts'
import { hashPassword, id, randomTemporaryPassword } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { normalizeUserSearchValue } from '../../common/user-search.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AuthService } from '../auth/auth.service.js'
import { assertPasswordPolicy } from '../auth/password-policy.js'
import { JobsService } from '../jobs/jobs.service.js'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly jobQueue: JobsService) {}

  async overview(principal: AuthPrincipal) {
    const [activeUsers, inactiveUsers, departments, roles, without2fa, failedJobs, recentAudit] = await Promise.all([
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, isActive: true } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, isActive: false } }),
      this.prisma.orgUnit.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, accountType: 'ADMIN', isActive: true } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, isActive: true, totpCredential: null } }),
      this.prisma.backgroundJob.count({ where: { state: 'FAILED' } }),
      this.prisma.auditEvent.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ])
    return { users: { active: activeUsers, inactive: inactiveUsers }, departments, administrators: roles, twoFactorCoverage: activeUsers ? Math.round((activeUsers - without2fa) / activeUsers * 100) : 0, attention: { without2fa, failedJobs }, recentAudit }
  }

  async users(principal: AuthPrincipal, search?: string, isActive?: string, companyId?: string, accountType?: string) {
    const rows = await this.prisma.user.findMany({ where: {
      workspaceId: principal.workspaceId,
      ...(companyId ? { primaryCompanyId: companyId } : {}),
      ...(isActive === 'true' || isActive === 'false' ? { isActive: isActive === 'true' } : {}),
      ...(accountType === 'ADMIN' || accountType === 'USER' ? { accountType } : {}),
      ...(search ? { OR: [{ displayName: { contains: search } }, { username: { contains: search } }, { jobTitle: { contains: search } }] } : {}),
    }, include: { primaryCompany: true, totpCredential: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } }, orderBy: { displayName: 'asc' } })
    return { items: rows.map((user) => ({ id: user.id, displayName: user.displayName, username: user.username, jobTitle: user.jobTitle, isActive: user.isActive, accountType: user.accountType, company: user.primaryCompany ? { id: user.primaryCompany.id, name: user.primaryCompany.displayName } : null, twoFactor: Boolean(user.totpCredential?.confirmedAt), activeSessionCount: user.sessions.length, avatarAsset: user.avatarAsset, updatedAt: user.updatedAt })) }
  }

  async userDetail(principal: AuthPrincipal, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId: principal.workspaceId }, include: { primaryCompany: true, orgAssignments: { where: { endedAt: null, isPrimary: true }, include: { orgUnit: true } }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }, totpCredential: true } })
    if (!user) throw notFound()
    const assignment = user.orgAssignments[0]
    return { id: user.id, displayName: user.displayName, firstName: user.firstName, lastName: user.lastName, middleName: user.middleName, username: user.username, contactEmail: user.contactEmail, phone: user.phone, gender: user.gender, birthDate: user.birthDate?.toISOString().slice(0, 10) ?? null, jobTitle: user.jobTitle, avatarAsset: user.avatarAsset?.startsWith('file_') ? `/api/v1/me/avatar/${user.avatarAsset}` : user.avatarAsset, accountType: user.accountType, company: user.primaryCompany ? { id: user.primaryCompany.id, name: user.primaryCompany.displayName } : null, orgUnit: assignment ? { id: assignment.orgUnitId, name: assignment.orgUnit.name } : null, approverId: user.approverId, timezone: user.timezone, isActive: user.isActive, version: user.authorizationVersion, security: { twoFactor: Boolean(user.totpCredential?.confirmedAt), activeSessions: user.sessions.length, mustEnroll2FA: user.mustEnroll2FA } }
  }

  async createUser(principal: AuthPrincipal, input: { firstName: string; lastName: string; middleName?: string; username: string; password: string; contactEmail: string; phone?: string; gender?: string | null; birthDate?: string | null; jobTitle?: string; accountType: 'ADMIN' | 'USER'; companyId?: string; orgUnitId?: string; isActive: boolean }) {
    const username = input.username.trim().toLowerCase()
    const displayName = [input.lastName, input.firstName, input.middleName].filter(Boolean).join(' ')
    if (!usernamePattern.test(username) || !displayName || (input.accountType === 'USER' && (!input.companyId || !input.orgUnitId)) || (input.accountType === 'ADMIN' && (input.companyId || input.orgUnitId))) throw badRequest('user_fields')
    assertPasswordPolicy(input.password, username, false)
    const [reservation, company, orgUnit] = await Promise.all([
      this.prisma.usernameReservation.findUnique({ where: { workspaceId_normalizedUsername: { workspaceId: principal.workspaceId, normalizedUsername: username } } }),
      input.companyId ? this.prisma.company.findFirst({ where: { id: input.companyId, workspaceId: principal.workspaceId, isActive: true } }) : Promise.resolve(null),
      input.orgUnitId ? this.prisma.orgUnit.findFirst({ where: { id: input.orgUnitId, workspaceId: principal.workspaceId, companyId: input.companyId, status: 'ACTIVE' } }) : Promise.resolve(null),
    ])
    if (reservation) throw conflict('Нікнейм уже використаний або зарезервований.')
    if (input.accountType === 'USER' && (!company || !orgUnit)) throw badRequest('user_assignment')
    const userId = id('usr')
    const passwordHash = await hashPassword(input.password)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({ data: { id: userId, workspaceId: principal.workspaceId, primaryCompanyId: company?.id ?? null, accountType: input.accountType, firstName: input.firstName.trim(), lastName: input.lastName.trim(), middleName: input.middleName?.trim() || null, displayName, normalizedDisplayName: normalizeUserSearchValue(displayName), username, normalizedUsername: username, contactEmail: input.contactEmail.trim(), phone: input.phone?.trim() || null, gender: input.gender ?? null, birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null, jobTitle: input.jobTitle?.trim() ?? '', isActive: input.isActive, mustEnroll2FA: false } })
      await tx.usernameReservation.create({ data: { id: id('unr'), workspaceId: principal.workspaceId, normalizedUsername: username, currentUserId: userId, state: 'ACTIVE' } })
      await tx.passwordCredential.create({ data: { id: id('pwd'), userId, passwordHash } })
      if (orgUnit && company) await tx.userOrgAssignment.create({ data: { id: id('uoa'), userId, companyId: company.id, orgUnitId: orgUnit.id, isPrimary: true, positionTitle: input.jobTitle?.trim() || null } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company?.id ?? null, actorType: 'USER', actorId: principal.userId, action: 'user.created', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ accountType: input.accountType, companyId: company?.id ?? null }), correlationId: id('corr') } })
    })
    return { userId, username }
  }

  async updateUser(principal: AuthPrincipal, userId: string, input: { firstName: string; lastName: string; middleName?: string; username: string; accountType: 'ADMIN' | 'USER'; companyId?: string; orgUnitId?: string; isActive: boolean; contactEmail?: string | null; phone?: string | null; gender?: string | null; birthDate?: string | null; jobTitle?: string; password?: string }) {
    const username = input.username.trim().toLowerCase()
    const displayName = [input.lastName, input.firstName, input.middleName].filter(Boolean).join(' ')
    if (!usernamePattern.test(username) || !displayName || (input.accountType === 'USER' && !input.companyId) || (input.accountType === 'ADMIN' && (input.companyId || input.orgUnitId))) throw badRequest('user_fields')
    const [user, company, orgUnit, conflictUser] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, workspaceId: principal.workspaceId } }),
      input.companyId ? this.prisma.company.findFirst({ where: { id: input.companyId, workspaceId: principal.workspaceId, isActive: true } }) : Promise.resolve(null),
      input.orgUnitId ? this.prisma.orgUnit.findFirst({ where: { id: input.orgUnitId, workspaceId: principal.workspaceId, companyId: input.companyId, status: 'ACTIVE' } }) : Promise.resolve(null),
      this.prisma.user.findFirst({ where: { workspaceId: principal.workspaceId, normalizedUsername: username, id: { not: userId } } }),
    ])
    if (!user) throw notFound()
    if (conflictUser) throw conflict('username_taken')
    if (input.accountType === 'USER' && !company) throw badRequest('user_assignment')
    if (input.password) assertPasswordPolicy(input.password, username, false)
    if (
      user.accountType === 'ADMIN'
      && user.isActive
      && (input.accountType !== 'ADMIN' || !input.isActive)
    ) {
      const admins = await this.prisma.user.count({ where: { workspaceId: principal.workspaceId, accountType: 'ADMIN', isActive: true } })
      if (admins <= 1) throw forbidden('last_admin')
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.user.update({ where: { id: userId }, data: { firstName: input.firstName.trim(), lastName: input.lastName.trim(), middleName: input.middleName?.trim() || null, displayName, normalizedDisplayName: normalizeUserSearchValue(displayName), username, normalizedUsername: username, accountType: input.accountType, primaryCompanyId: company?.id ?? null, isActive: input.isActive, contactEmail: input.contactEmail, phone: input.phone === undefined ? user.phone : input.phone?.trim() || null, gender: input.gender === undefined ? user.gender : input.gender, birthDate: input.birthDate === undefined ? user.birthDate : input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null, jobTitle: input.jobTitle?.trim() ?? user.jobTitle, authorizationVersion: { increment: 1 } } })
      if (orgUnit && company) {
        await tx.userOrgAssignment.updateMany({ where: { userId, endedAt: null }, data: { endedAt: new Date(), isPrimary: false } })
        await tx.userOrgAssignment.create({ data: { id: id('uoa'), userId, companyId: company.id, orgUnitId: orgUnit.id, isPrimary: true, positionTitle: input.jobTitle?.trim() || null } })
      }
      if (input.password) {
        const passwordHash = await hashPassword(input.password)
        await tx.passwordCredential.upsert({ where: { userId }, create: { id: id('pwd'), userId, passwordHash }, update: { passwordHash, credentialVersion: { increment: 1 }, changedAt: new Date() } })
        await tx.temporaryCredential.updateMany({ where: { userId, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } })
        await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'admin_password_changed' } })
      }
      if (!input.isActive) await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'deactivated' } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company?.id ?? null, actorType: 'USER', actorId: principal.userId, action: 'user.updated', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ accountType: input.accountType, companyId: company?.id ?? null }), correlationId: id('corr') } })
      return value
    })
    return { id: updated.id }
  }

  async updateAvatar(principal: AuthPrincipal, userId: string, fileId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId: principal.workspaceId } })
    if (!user) throw notFound()
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { avatarAsset: fileId } }),
      this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: user.primaryCompanyId, actorType: 'USER', actorId: principal.userId, action: 'user.avatar_updated', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } }),
    ])
    return { avatarAsset: `/api/v1/me/avatar/${fileId}` }
  }

  async resetPassword(principal: AuthPrincipal, targetId: string, input: { reauthChallengeId?: string; reason: string; verificationMethod: string }) {
    await this.auth.assertRecentReauth(principal, input.reauthChallengeId)
    if (!input.reason.trim() || !input.verificationMethod.trim()) throw badRequest('reset_reason_required')
    const target = await this.prisma.user.findFirst({ where: { id: targetId, workspaceId: principal.workspaceId } })
    if (!target) throw notFound()
    const isFullAdmin = target.accountType === 'ADMIN'
    if (isFullAdmin) {
      const fullAdmins = await this.prisma.user.count({ where: { workspaceId: principal.workspaceId, isActive: true, accountType: 'ADMIN' } })
      if (fullAdmins <= 1) throw forbidden('Для останнього повного адміністратора використайте задокументовану break-glass CLI-процедуру.')
      const approvalId = id('cra')
      await this.prisma.credentialResetApproval.create({ data: { id: approvalId, targetId, initiatorId: principal.userId, resetType: 'PASSWORD', state: 'PENDING', reason: input.reason.trim(), expiresAt: new Date(Date.now() + 15 * 60_000) } })
      return { state: 'PENDING_SECOND_APPROVAL', approvalId }
    }
    return this.issueTemporaryCredential(principal, targetId, input.reason)
  }

  async approveReset(principal: AuthPrincipal, approvalId: string, reauthChallengeId?: string) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId)
    const approval = await this.prisma.credentialResetApproval.findFirst({ where: { id: approvalId, state: 'PENDING', expiresAt: { gt: new Date() } } })
    if (!approval) throw notFound()
    if (approval.initiatorId === principal.userId || approval.targetId === principal.userId) throw forbidden('Ініціатор, погоджувач і цільова особа мають бути різними для цієї дії.')
    await this.prisma.credentialResetApproval.update({ where: { id: approval.id }, data: { approverId: principal.userId, state: 'APPROVED', approvedAt: new Date() } })
    return { state: 'APPROVED', approvalId }
  }

  async finalizeReset(principal: AuthPrincipal, approvalId: string, reauthChallengeId?: string) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId)
    const approval = await this.prisma.credentialResetApproval.findFirst({ where: { id: approvalId, initiatorId: principal.userId, state: 'APPROVED', expiresAt: { gt: new Date() }, approverId: { not: null } } })
    if (!approval) throw notFound()
    const result = await this.issueTemporaryCredential(principal, approval.targetId, approval.reason)
    await this.prisma.credentialResetApproval.update({ where: { id: approval.id }, data: { state: 'COMPLETED' } })
    return result
  }

  async unlock(principal: AuthPrincipal, targetId: string, reason: string, reauthChallengeId?: string) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId)
    if (!reason.trim()) throw badRequest('reason_required')
    await this.prisma.loginAttempt.deleteMany({ where: { resolvedUserId: targetId, result: 'FAILURE' } })
    await this.prisma.credentialEvent.create({ data: { id: id('cev'), userId: targetId, actorId: principal.userId, type: 'account_unlocked', result: 'SUCCESS', reasonCode: reason.trim(), correlationId: id('corr') } })
    return { unlocked: true }
  }

  async deactivate(principal: AuthPrincipal, targetId: string, input: { newOwnerId?: string; reason: string }) {
    if (targetId === principal.userId) throw forbidden('Не можна деактивувати власний акаунт.')
    const target = await this.prisma.user.findFirst({ where: { id: targetId, workspaceId: principal.workspaceId } })
    if (!target) throw notFound()
    if (target.accountType === 'ADMIN' && target.isActive) {
      const fullAdminCount = await this.prisma.user.count({ where: { workspaceId: principal.workspaceId, isActive: true, accountType: 'ADMIN' } })
      if (fullAdminCount <= 1) throw forbidden('Не можна деактивувати останнього повного адміністратора.')
    }
    const activeTaskWhere = {
      status: { notIn: ['DONE', 'ARCHIVED', 'CANCELLED'] },
      OR: [
        { reporterId: targetId },
        {
          participants: {
            some: {
              userId: targetId,
              role: 'RESPONSIBLE' as const,
              removedAt: null,
            },
          },
        },
      ],
    } satisfies Prisma.TaskWhereInput
    const [tasks, documents] = await Promise.all([
      this.prisma.task.count({ where: activeTaskWhere }),
      this.prisma.document.count({ where: { ownerId: targetId, archivedAt: null } }),
    ])
    if ((tasks + documents) > 0 && !input.newOwnerId) return { blocked: true, impact: { tasks, documents } }
    await this.prisma.$transaction(async (tx) => {
      if (input.newOwnerId) {
        const affectedTasks = await tx.task.findMany({
          where: activeTaskWhere,
          select: { id: true, reporterId: true },
        })
        await tx.task.updateMany({
          where: {
            id: { in: affectedTasks.filter((task) => task.reporterId === targetId).map((task) => task.id) },
          },
          data: {
            reporterId: input.newOwnerId,
            version: { increment: 1 },
          },
        })
        for (const task of affectedTasks) {
          const responsible = await tx.taskParticipant.findUnique({
            where: { taskId_userId: { taskId: task.id, userId: targetId } },
          })
          if (responsible?.role !== 'RESPONSIBLE' || responsible.removedAt) continue
          await tx.taskParticipant.upsert({
            where: { taskId_userId: { taskId: task.id, userId: input.newOwnerId } },
            create: {
              id: id('tpart'),
              taskId: task.id,
              userId: input.newOwnerId,
              role: 'RESPONSIBLE',
              addedById: principal.userId,
            },
            update: {
              role: 'RESPONSIBLE',
              removedAt: null,
              addedById: principal.userId,
            },
          })
          await tx.taskParticipant.update({
            where: { id: responsible.id },
            data: { removedAt: new Date() },
          })
        }
        await tx.document.updateMany({ where: { ownerId: targetId, archivedAt: null }, data: { ownerId: input.newOwnerId } })
      }
      await tx.user.update({ where: { id: targetId }, data: { isActive: false, authorizationVersion: { increment: 1 } } })
      await tx.userSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'deactivated' } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: target.primaryCompanyId, actorType: 'USER', actorId: principal.userId, action: 'user.deactivated', entityType: 'USER', entityId: targetId, result: 'SUCCESS', risk: 'CRITICAL', reasonCode: input.reason, safeDiffJson: JSON.stringify({ newOwnerId: input.newOwnerId, tasks, documents }), correlationId: id('corr') } })
    })
    return { deactivated: true }
  }

  async organizationCapabilities(principal: AuthPrincipal) {
    const companyId = principal.primaryCompanyId ?? principal.allowedCompanyIds[0]
    if (!companyId) throw notFound()
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId }, select: { id: true } })
    if (!company) throw notFound()
    const rows = await this.prisma.companyCapability.findMany({ where: { companyId }, orderBy: { code: 'asc' } })
    return { items: allOrganizationCapabilityCodes.map((code) => {
      const row = rows.find((item) => item.code === code)
      return {
        code,
        enabled: row?.enabled ?? false,
        version: row?.version ?? 0,
        enabledAt: row?.enabledAt?.toISOString() ?? null,
        disabledAt: row?.disabledAt?.toISOString() ?? null,
      }
    }) }
  }

  async updateOrganizationCapability(
    principal: AuthPrincipal,
    code: OrganizationCapabilityCode,
    input: UpdateOrganizationCapability,
  ) {
    const companyId = principal.primaryCompanyId ?? principal.allowedCompanyIds[0]
    if (!companyId) throw notFound()
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId: principal.workspaceId }, select: { id: true } })
    if (!company) throw notFound()
    const current = await this.prisma.companyCapability.findUnique({ where: { companyId_code: { companyId, code } } })
    if ((current?.version ?? 0) !== input.expectedVersion) throw conflict()
    const now = new Date()
    const nextVersion = input.expectedVersion + 1
    const capability = await this.prisma.$transaction(async (tx) => {
      let row
      if (current) {
        const updated = await tx.companyCapability.updateMany({
          where: { id: current.id, version: input.expectedVersion },
          data: {
            enabled: input.enabled,
            enabledById: input.enabled ? principal.userId : null,
            enabledAt: input.enabled ? now : current.enabledAt,
            disabledAt: input.enabled ? null : now,
            version: nextVersion,
          },
        })
        if (updated.count !== 1) throw conflict()
        row = await tx.companyCapability.findUniqueOrThrow({ where: { id: current.id } })
      } else {
        row = await tx.companyCapability.create({
            data: {
              id: id('cap'), companyId, code, enabled: input.enabled,
              enabledById: input.enabled ? principal.userId : null,
              enabledAt: input.enabled ? now : null,
              disabledAt: input.enabled ? null : now,
              version: nextVersion,
            },
          })
      }
      await tx.auditEvent.create({ data: {
        id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId,
        action: 'company.capability_changed', entityType: 'COMPANY_CAPABILITY', entityId: row.id, result: 'SUCCESS', risk: 'HIGH',
        safeDiffJson: JSON.stringify({ code, before: current?.enabled ?? false, after: input.enabled, version: nextVersion }), correlationId: id('corr'),
      } })
      await tx.outboxEvent.create({ data: {
        id: id('out'), aggregateType: 'COMPANY_CAPABILITY', aggregateId: row.id, aggregateVersion: nextVersion,
        eventType: 'capability.changed', safePayload: JSON.stringify({ companyId, code, enabled: input.enabled, version: nextVersion }),
      } })
      return row
    })
    return { code, enabled: capability.enabled, version: capability.version, enabledAt: capability.enabledAt?.toISOString() ?? null, disabledAt: capability.disabledAt?.toISOString() ?? null }
  }

  async auditLog(principal: AuthPrincipal, page = 1) {
    const pageSize = 50
    const [items, total] = await this.prisma.$transaction([this.prisma.auditEvent.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }), this.prisma.auditEvent.count({ where: { workspaceId: principal.workspaceId } })])
    return { items, page, pageSize, total }
  }

  async requestAuditExport(principal: AuthPrincipal, idempotencyKey: string) {
    if (!idempotencyKey.trim()) throw badRequest('idempotency_key_required')
    const exportId = id('export')
    const jobId = await this.jobQueue.enqueue('export.generate', 'AUDIT_EXPORT', exportId, {
      workspaceId: principal.workspaceId, actorId: principal.userId, companyId: principal.primaryCompanyId, exportId,
    }, `audit-export:${principal.workspaceId}:${principal.userId}:${idempotencyKey}`)
    const job = await this.prisma.backgroundJob.findUnique({ where: { id: jobId } })
    const effectiveExportId = job?.entityId ?? exportId
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: principal.primaryCompanyId, actorType: 'USER', actorId: principal.userId, action: 'audit.export_requested', entityType: 'AUDIT_EXPORT', entityId: effectiveExportId, result: 'QUEUED', risk: 'HIGH', safeDiffJson: JSON.stringify({ jobId }), correlationId: id('corr') } })
    return { exportId: effectiveExportId, jobId, state: job?.state ?? 'QUEUED' }
  }

  async auditExportStatus(principal: AuthPrincipal, exportId: string) {
    const job = await this.prisma.backgroundJob.findFirst({ where: { type: 'export.generate', entityType: 'AUDIT_EXPORT', entityId: exportId } })
    if (!job) throw notFound()
    let payload: Record<string, unknown> = {}
    try { payload = JSON.parse(job.safePayload) as Record<string, unknown> } catch { throw notFound() }
    if (payload.workspaceId !== principal.workspaceId) throw notFound()
    const link = await this.prisma.fileLink.findFirst({ where: { entityType: 'AUDIT_EXPORT', entityId: exportId, purpose: 'EXPORT' }, select: { fileId: true } })
    return { exportId, jobId: job.id, state: job.state, progress: job.progress, lastErrorCode: job.lastErrorCode, fileId: link?.fileId ?? null, expiresAt: link ? new Date(job.createdAt.getTime() + 24 * 3_600_000).toISOString() : null }
  }

  async jobs() {
    return { items: await this.prisma.backgroundJob.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 }) }
  }

  async retryJob(principal: AuthPrincipal, jobId: string) {
    const result = await this.prisma.backgroundJob.updateMany({ where: { id: jobId, state: 'FAILED' }, data: { state: 'QUEUED', runAt: new Date(), lastErrorCode: null, leaseOwner: null, leaseUntil: null } })
    if (!result.count) throw conflict('Фонову роботу не можна повторити в поточному стані.')
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'job.retried', entityType: 'JOB', entityId: jobId, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    return { queued: true }
  }

  async securityPolicy() {
    const setting = await this.prisma.systemSetting.findFirst({ where: { key: 'security-policy', effectiveAt: { lte: new Date() } }, orderBy: { version: 'desc' } })
    return setting ? { ...JSON.parse(setting.valueJson) as object, version: setting.version, effectiveAt: setting.effectiveAt } : { require2faAccountTypes: ['ADMIN'], temporaryPasswordHours: 24, sessionHours: 12, version: 0 }
  }

  async updateSecurityPolicy(principal: AuthPrincipal, input: { expectedVersion: number; require2faAccountTypes: Array<'ADMIN' | 'USER'>; temporaryPasswordHours: number; sessionHours: number; effectiveAt: string }, reauthChallengeId?: string) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId)
    const current = await this.securityPolicy()
    if (current.version !== input.expectedVersion) throw conflict()
    const affectedUsers = await this.prisma.user.count({ where: { accountType: { in: input.require2faAccountTypes }, isActive: true } })
    await this.prisma.systemSetting.create({ data: { id: id('set'), key: 'security-policy', valueJson: JSON.stringify({ require2faAccountTypes: input.require2faAccountTypes, temporaryPasswordHours: input.temporaryPasswordHours, sessionHours: input.sessionHours }), version: input.expectedVersion + 1, effectiveAt: new Date(input.effectiveAt), updatedBy: principal.userId } })
    return { version: input.expectedVersion + 1, affectedUsers }
  }

  private async issueTemporaryCredential(principal: AuthPrincipal, targetId: string, reason: string) {
    const target = await this.prisma.user.findFirst({ where: { id: targetId, workspaceId: principal.workspaceId } })
    if (!target) throw notFound()
    const temporaryPassword = randomTemporaryPassword()
    const secretHash = await hashPassword(temporaryPassword)
    const expiresAt = new Date(Date.now() + getConfig().TEMPORARY_PASSWORD_HOURS * 3_600_000)
    await this.prisma.$transaction(async (tx) => {
      await tx.temporaryCredential.updateMany({ where: { userId: targetId, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } })
      await tx.temporaryCredential.create({ data: { id: id('tmp'), userId: targetId, secretHash, purpose: 'ADMIN_RESET', expiresAt, createdBy: principal.userId } })
      await tx.userSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'admin_password_reset' } })
      await tx.user.update({ where: { id: targetId }, data: { authorizationVersion: { increment: 1 } } })
      await tx.credentialEvent.create({ data: { id: id('cev'), userId: targetId, actorId: principal.userId, type: 'admin_password_reset', result: 'SUCCESS', reasonCode: reason.trim(), correlationId: id('corr') } })
      await tx.notification.upsert({ where: { dedupeKey: `credential-reset:${targetId}:${expiresAt.toISOString()}` }, create: { id: id('ntf'), recipientId: targetId, category: 'SECURITY', safeTitle: 'Адміністратор скинув пароль', safeSnippet: 'Після встановлення нового пароля перевірте активні сесії.', entityType: 'USER', entityId: targetId, requiresAction: true, dedupeKey: `credential-reset:${targetId}:${expiresAt.toISOString()}` }, update: {} })
    })
    return { state: 'COMPLETED', username: target.username, temporaryPassword, expiresAt: expiresAt.toISOString() }
  }
}
