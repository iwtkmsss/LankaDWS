import { Injectable } from '@nestjs/common'
import {
  allOrganizationCapabilityCodes,
  usernamePattern,
  allPermissionCodes,
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
import { JobsService } from '../jobs/jobs.service.js'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly jobQueue: JobsService) {}

  async overview(principal: AuthPrincipal) {
    const [activeUsers, pendingUsers, inactiveUsers, departments, roles, without2fa, failedJobs, recentAudit] = await Promise.all([
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, status: 'PENDING_FIRST_LOGIN' } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, status: 'DEACTIVATED' } }),
      this.prisma.orgUnit.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
      this.prisma.role.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE', totpCredential: null } }),
      this.prisma.backgroundJob.count({ where: { state: 'FAILED' } }),
      this.prisma.auditEvent.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ])
    return { users: { active: activeUsers, pending: pendingUsers, deactivated: inactiveUsers }, departments, roles, twoFactorCoverage: activeUsers ? Math.round((activeUsers - without2fa) / activeUsers * 100) : 0, attention: { pendingUsers, without2fa, failedJobs }, recentAudit }
  }

  async users(principal: AuthPrincipal, search?: string, status?: string) {
    const rows = await this.prisma.user.findMany({ where: {
      workspaceId: principal.workspaceId,
      ...(status ? { status: status as 'ACTIVE' } : {}),
      ...(search ? { OR: [{ displayName: { contains: search } }, { username: { contains: search } }, { jobTitle: { contains: search } }] } : {}),
    }, include: { roles: { where: { status: 'ACTIVE' }, include: { role: true } }, totpCredential: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } }, orderBy: { displayName: 'asc' } })
    return { items: rows.map((user) => ({ id: user.id, displayName: user.displayName, username: user.username, jobTitle: user.jobTitle, status: user.status, roles: user.roles.map((entry) => ({ id: entry.role.id, name: entry.role.name })), displayRole: user.displayRole, twoFactor: Boolean(user.totpCredential?.confirmedAt), activeSessionCount: user.sessions.length, avatarAsset: user.avatarAsset, updatedAt: user.updatedAt })) }
  }

  async userDetail(principal: AuthPrincipal, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId: principal.workspaceId }, include: { roles: { include: { role: { include: { permissions: true } } } }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }, totpCredential: true } })
    if (!user) throw notFound()
    return { id: user.id, displayName: user.displayName, username: user.username, contactEmail: user.contactEmail, jobTitle: user.jobTitle, displayRole: user.displayRole, approverId: user.approverId, timezone: user.timezone, status: user.status, version: user.authorizationVersion, roles: user.roles.map((entry) => entry.role), security: { twoFactor: Boolean(user.totpCredential?.confirmedAt), activeSessions: user.sessions.length, mustChangePassword: user.mustChangePassword, mustEnroll2FA: user.mustEnroll2FA } }
  }

  async createUser(principal: AuthPrincipal, input: { displayName: string; username: string; roleId: string; jobTitle?: string; contactEmail?: string; approverId?: string }) {
    const username = input.username.trim().toLowerCase()
    if (!usernamePattern.test(username) || !input.displayName.trim()) throw badRequest('user_fields')
    const [reservation, company, role] = await Promise.all([
      this.prisma.usernameReservation.findUnique({ where: { workspaceId_normalizedUsername: { workspaceId: principal.workspaceId, normalizedUsername: username } } }),
      this.prisma.company.findFirst({ where: { id: principal.primaryCompanyId, workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
      this.prisma.role.findFirst({ where: { id: input.roleId, workspaceId: principal.workspaceId, status: 'ACTIVE' } }),
    ])
    if (reservation) throw conflict('Нікнейм уже використаний або зарезервований.')
    if (!company || !role) throw badRequest('user_assignment')
    const userId = id('usr')
    const temporaryPassword = randomTemporaryPassword()
    const secretHash = await hashPassword(temporaryPassword)
    const expiresAt = new Date(Date.now() + getConfig().TEMPORARY_PASSWORD_HOURS * 3_600_000)
    await this.prisma.$transaction(async (tx) => {
      const displayName = input.displayName.trim()
      await tx.user.create({ data: { id: userId, workspaceId: principal.workspaceId, primaryCompanyId: company.id, displayName, normalizedDisplayName: normalizeUserSearchValue(displayName), username, normalizedUsername: username, contactEmail: input.contactEmail?.trim() || null, jobTitle: input.jobTitle?.trim() ?? '', displayRole: role.name, approverId: input.approverId, status: 'PENDING_FIRST_LOGIN', mustChangePassword: true, mustEnroll2FA: role.isFullAdmin } })
      await tx.usernameReservation.create({ data: { id: id('unr'), workspaceId: principal.workspaceId, normalizedUsername: username, currentUserId: userId, state: 'ACTIVE' } })
      await tx.userCompanyAccess.create({ data: { id: id('uca'), userId, companyId: company.id, grantedBy: principal.userId } })
      await tx.userRole.create({ data: { id: id('ur'), userId, roleId: role.id, grantedBy: principal.userId } })
      await tx.temporaryCredential.create({ data: { id: id('tmp'), userId, secretHash, purpose: 'FIRST_LOGIN', expiresAt, createdBy: principal.userId } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: company.id, actorType: 'USER', actorId: principal.userId, action: 'user.created', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ roleId: role.id, companyId: company.id }), correlationId: id('corr') } })
    })
    return { userId, username, temporaryPassword, expiresAt: expiresAt.toISOString() }
  }

  async resetPassword(principal: AuthPrincipal, targetId: string, input: { reauthChallengeId?: string; reason: string; verificationMethod: string }) {
    await this.auth.assertRecentReauth(principal, input.reauthChallengeId)
    if (!input.reason.trim() || !input.verificationMethod.trim()) throw badRequest('reset_reason_required')
    const target = await this.prisma.user.findFirst({ where: { id: targetId, workspaceId: principal.workspaceId }, include: { roles: { where: { status: 'ACTIVE' }, include: { role: true } } } })
    if (!target) throw notFound()
    const isFullAdmin = target.roles.some((entry) => entry.role.isFullAdmin)
    if (isFullAdmin) {
      const fullAdmins = await this.prisma.user.count({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE', roles: { some: { status: 'ACTIVE', role: { isFullAdmin: true, status: 'ACTIVE' } } } } })
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
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, include: { roles: { include: { role: true } } } })
    if (!target) throw notFound()
    if (target.roles.some((entry) => entry.role.isFullAdmin)) {
      const fullAdminCount = await this.prisma.user.count({ where: { status: 'ACTIVE', roles: { some: { status: 'ACTIVE', role: { isFullAdmin: true } } } } })
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
      await tx.user.update({ where: { id: targetId }, data: { status: 'DEACTIVATED', authorizationVersion: { increment: 1 } } })
      await tx.userSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'deactivated' } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: target.primaryCompanyId, actorType: 'USER', actorId: principal.userId, action: 'user.deactivated', entityType: 'USER', entityId: targetId, result: 'SUCCESS', risk: 'CRITICAL', reasonCode: input.reason, safeDiffJson: JSON.stringify({ newOwnerId: input.newOwnerId, tasks, documents }), correlationId: id('corr') } })
    })
    return { deactivated: true }
  }

  async roles(principal: AuthPrincipal) {
    const roles = await this.prisma.role.findMany({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE' }, include: { permissions: true, users: { where: { status: 'ACTIVE' } } }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] })
    return { items: roles.map((role) => ({ ...role, permissions: role.permissions, userCount: role.users.length })) }
  }

  async updateRole(principal: AuthPrincipal, roleId: string, input: { expectedVersion: number; name?: string; permissions: Array<{ code: string; scope: 'OWN' | 'SELECTED_COMPANIES' | 'ALL_COMPANIES'; companyIds?: string[] }> }) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, workspaceId: principal.workspaceId }, include: { permissions: true, users: true } })
    if (!role) throw notFound()
    if (role.version !== input.expectedVersion) throw conflict()
    if (input.permissions.some((entry) => !allPermissionCodes.includes(entry.code as never))) throw badRequest('permission_code')
    if (role.isFullAdmin && !input.permissions.some((entry) => entry.code === 'roles.manage')) throw forbidden('Критичну основу системної ролі адміністратора не можна прибрати.')
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } })
      await tx.rolePermission.createMany({ data: input.permissions.map((permission) => ({ id: id('rp'), roleId, permissionCode: permission.code, scope: permission.scope, companyIdsJson: JSON.stringify(permission.companyIds ?? []) })) })
      await tx.role.update({ where: { id: roleId }, data: { ...(input.name && !role.isSystem ? { name: input.name.trim(), normalizedName: input.name.trim().toLowerCase() } : {}), version: { increment: 1 } } })
      await tx.user.updateMany({ where: { roles: { some: { roleId, status: 'ACTIVE' } } }, data: { authorizationVersion: { increment: 1 } } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, actorType: 'USER', actorId: principal.userId, action: 'role.updated', entityType: 'ROLE', entityId: roleId, result: 'SUCCESS', risk: 'CRITICAL', safeDiffJson: JSON.stringify({ before: role.permissions.map((entry) => entry.permissionCode), after: input.permissions.map((entry) => entry.code), affectedUsers: role.users.length }), correlationId: id('corr') } })
    })
    return { version: input.expectedVersion + 1, affectedUsers: role.users.length }
  }

  async organizationCapabilities(principal: AuthPrincipal) {
    const companyId = principal.primaryCompanyId
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
    const companyId = principal.primaryCompanyId
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
    return setting ? { ...JSON.parse(setting.valueJson) as object, version: setting.version, effectiveAt: setting.effectiveAt } : { require2faRoles: ['Адміністратор'], temporaryPasswordHours: 24, sessionHours: 12, version: 0 }
  }

  async updateSecurityPolicy(principal: AuthPrincipal, input: { expectedVersion: number; require2faRoles: string[]; temporaryPasswordHours: number; sessionHours: number; effectiveAt: string }, reauthChallengeId?: string) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId)
    const current = await this.securityPolicy()
    if (current.version !== input.expectedVersion) throw conflict()
    const affectedUsers = await this.prisma.user.count({ where: { displayRole: { in: input.require2faRoles }, status: 'ACTIVE' } })
    await this.prisma.systemSetting.create({ data: { id: id('set'), key: 'security-policy', valueJson: JSON.stringify({ require2faRoles: input.require2faRoles, temporaryPasswordHours: input.temporaryPasswordHours, sessionHours: input.sessionHours }), version: input.expectedVersion + 1, effectiveAt: new Date(input.effectiveAt), updatedBy: principal.userId } })
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
      await tx.user.update({ where: { id: targetId }, data: { mustChangePassword: true, status: 'PENDING_FIRST_LOGIN', authorizationVersion: { increment: 1 } } })
      await tx.credentialEvent.create({ data: { id: id('cev'), userId: targetId, actorId: principal.userId, type: 'admin_password_reset', result: 'SUCCESS', reasonCode: reason.trim(), correlationId: id('corr') } })
      await tx.notification.upsert({ where: { dedupeKey: `credential-reset:${targetId}:${expiresAt.toISOString()}` }, create: { id: id('ntf'), recipientId: targetId, category: 'SECURITY', safeTitle: 'Адміністратор скинув пароль', safeSnippet: 'Після встановлення нового пароля перевірте активні сесії.', entityType: 'USER', entityId: targetId, requiresAction: true, dedupeKey: `credential-reset:${targetId}:${expiresAt.toISOString()}` }, update: {} })
    })
    return { state: 'COMPLETED', username: target.username, temporaryPassword, expiresAt: expiresAt.toISOString() }
  }
}
