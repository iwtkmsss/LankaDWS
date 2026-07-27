import { Injectable } from '@nestjs/common'
import type { PageResult, RequestListItem } from '@bert-crm/contracts'
import { encryptSecret, id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

export interface AbsenceInput {
  companyId?: string
  requestId?: string
  expectedVersion?: number
  startDate: string
  endDate: string
  substituteId: string
  privateHrComment?: string
}

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async list(
    principal: AuthPrincipal,
    company: string | undefined,
    segment = 'mine',
    page = 1,
    pageSize = 25,
    search?: string,
  ): Promise<PageResult<RequestListItem> & { counts: { mine: number; approval: number; company: number } }> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const normalizedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
    const normalizedSearch = search?.trim().slice(0, 100) ?? ''
    const normalizedSegment = segment === 'approval' && principal.permissions.has('requests.approve')
      ? 'approval'
      : segment === 'company' && principal.permissions.has('confidential.hr.read')
        ? 'company'
        : 'mine'
    const segmentWhere = normalizedSegment === 'approval'
      ? { currentApproverId: principal.userId, decisionStatus: 'PENDING' as const }
      : normalizedSegment === 'company'
        ? {}
        : { authorId: principal.userId }
    const searchWhere = normalizedSearch
      ? {
          OR: [
            { number: { contains: normalizedSearch } },
            { snapshots: { some: { safeSummary: { contains: normalizedSearch } } } },
          ],
        }
      : {}
    const baseWhere = { companyId: { in: companyIds } }
    const where = { ...baseWhere, ...segmentWhere, ...searchWhere }
    const [rows, total, mine, approval, companyTotal] = await this.prisma.$transaction([
      this.prisma.request.findMany({ where, include: { snapshots: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (normalizedPage - 1) * pageSize, take: pageSize }),
      this.prisma.request.count({ where }),
      this.prisma.request.count({ where: { ...baseWhere, authorId: principal.userId } }),
      this.prisma.request.count({
        where: {
          ...baseWhere,
          currentApproverId: principal.userId,
          decisionStatus: 'PENDING',
        },
      }),
      principal.permissions.has('confidential.hr.read')
        ? this.prisma.request.count({ where: baseWhere })
        : this.prisma.request.count({ where: { id: '__not_available__' } }),
    ])
    return {
      items: await this.mapRows(rows),
      page: normalizedPage,
      pageSize,
      total,
      counts: { mine, approval, company: companyTotal },
    }
  }

  async detail(principal: AuthPrincipal, requestId: string) {
    const request = await this.prisma.request.findFirst({
      where: { id: requestId, companyId: { in: principal.allowedCompanyIds }, OR: [{ authorId: principal.userId }, { currentApproverId: principal.userId }, ...(principal.permissions.has('confidential.hr.read') ? [{}] : [])] },
      include: { snapshots: { orderBy: { version: 'desc' } }, approvals: { orderBy: { createdAt: 'asc' } }, effects: true },
    })
    if (!request) throw notFound()
    const [author, approver, links] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: request.authorId }, select: { id: true, displayName: true, jobTitle: true, avatarAsset: true } }),
      request.currentApproverId ? this.prisma.user.findUnique({ where: { id: request.currentApproverId }, select: { id: true, displayName: true } }) : null,
      this.prisma.entityLink.findMany({ where: { OR: [{ sourceType: 'REQUEST', sourceId: request.id }, { targetType: 'REQUEST', targetId: request.id }] } }),
    ])
    return { ...request, author, currentApprover: approver, links, privateFieldsHidden: !principal.permissions.has('confidential.hr.read') && request.authorId !== principal.userId }
  }

  async submitAbsence(principal: AuthPrincipal, input: AbsenceInput, idempotencyKey: string) {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    const startAt = new Date(`${input.startDate}T00:00:00.000Z`)
    const endAt = new Date(`${input.endDate}T23:59:59.999Z`)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt < startAt) throw badRequest('absence_dates')
    const author = await this.prisma.user.findUnique({ where: { id: principal.userId } })
    if (!author?.approverId) throw badRequest('approval_route_missing', 'Для профілю не визначено погоджувача. Чернетку збережено, але надсилання заблоковано.')
    const approverId = author.approverId
    const substitute = await this.prisma.user.findFirst({ where: { id: input.substituteId, status: 'ACTIVE', companyAccess: { some: { companyId, status: 'ACTIVE' } } } })
    if (!substitute) throw badRequest('substitute_invalid')
    const type = await this.prisma.requestType.findFirst({ where: { workspaceId: principal.workspaceId, category: 'ABSENCE', status: 'ACTIVE' } })
    if (!type) throw badRequest('request_type_unavailable')

    if (input.requestId) return this.resubmit(principal, input, idempotencyKey, approverId, startAt, endAt)
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { userId_key_operation: { userId: principal.userId, key: idempotencyKey, operation: 'request.submit' } } })
    if (existing?.resultId) return this.detail(principal, existing.resultId)

    const requestId = id('req')
    const number = `REQ-${Date.now().toString().slice(-7)}`
    const snapshotValues = { type: 'absence', startAt: startAt.toISOString(), endAt: endAt.toISOString(), substituteId: substitute.id, workdays: this.workdays(startAt, endAt) }
    await this.prisma.$transaction(async (tx) => {
      await tx.request.create({ data: { id: requestId, workspaceId: principal.workspaceId, companyId, number, authorId: principal.userId, typeId: type.id, typeVersion: type.currentVersion, routeVersion: 1, version: 1, decisionStatus: 'PENDING', executionStatus: 'NOT_STARTED', currentApproverId: approverId, confidentiality: 'HR_SECURITY', slaDueAt: new Date(Date.now() + 2 * 86_400_000), idempotencyKey } })
      await tx.requestSnapshot.create({ data: { id: id('snap'), requestId, version: 1, valuesJson: JSON.stringify(snapshotValues), safeSummary: `Відсутність · ${input.startDate} — ${input.endDate}`, authorId: principal.userId } })
      if (input.privateHrComment?.trim()) await tx.requestPrivateDetail.create({ data: { id: id('priv'), requestId, version: 1, encryptedJson: encryptSecret(JSON.stringify({ comment: input.privateHrComment.trim() })) } })
      await tx.approvalAttempt.create({ data: { id: id('apr'), requestId, requestVersion: 1, approverId, state: 'PENDING', idempotencyKey: `pending:${requestId}:1` } })
      await tx.idempotencyRecord.create({ data: { id: id('idem'), userId: principal.userId, key: idempotencyKey, operation: 'request.submit', requestFingerprint: idempotencyKey, resultType: 'REQUEST', resultId: requestId, responseStatus: 201, expiresAt: new Date(Date.now() + 86_400_000) } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId, action: 'request.submitted', entityType: 'REQUEST', entityId: requestId, result: 'SUCCESS', risk: 'NORMAL', safeDiffJson: JSON.stringify({ version: 1 }), correlationId: id('corr') } })
      await tx.outboxEvent.create({ data: { id: id('out'), aggregateType: 'REQUEST', aggregateId: requestId, aggregateVersion: 1, eventType: 'request.notify-approver', safePayload: JSON.stringify({ approverId, safeSummary: `Відсутність · ${input.startDate} — ${input.endDate}` }) } })
    })
    return this.detail(principal, requestId)
  }

  async approve(principal: AuthPrincipal, requestId: string, expectedVersion: number, idempotencyKey: string) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId }, include: { snapshots: { where: { version: expectedVersion }, take: 1 } } })
    if (!request || request.companyId && !principal.allowedCompanyIds.includes(request.companyId)) throw notFound()
    const repeated = await this.prisma.approvalAttempt.findFirst({ where: { requestId, requestVersion: expectedVersion, approverId: principal.userId, state: 'APPROVED', idempotencyKey } })
    if (repeated) return this.detail(principal, requestId)
    if (request.currentApproverId !== principal.userId || request.decisionStatus !== 'PENDING') throw forbidden()
    if (request.version !== expectedVersion || !request.snapshots[0]) throw conflict(`Поточна версія: ${request.version}`)
    const prior = await this.prisma.approvalAttempt.findFirst({ where: { requestId, requestVersion: expectedVersion, approverId: principal.userId, state: 'APPROVED' } })
    if (prior) return this.detail(principal, requestId)
    const values = JSON.parse(request.snapshots[0].valuesJson) as { startAt: string; endAt: string; substituteId: string }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({ where: { id: requestId, version: expectedVersion, decisionStatus: 'PENDING' }, data: { decisionStatus: 'APPROVED', executionStatus: 'QUEUED' } })
      if (!updated.count) throw conflict()
      await tx.approvalAttempt.updateMany({ where: { requestId, requestVersion: expectedVersion, approverId: principal.userId, state: 'PENDING' }, data: { state: 'APPROVED', decidedAt: new Date(), idempotencyKey } })
      for (const effectType of ['absence.calendar', 'absence.presence', 'absence.notifications']) {
        await tx.approvalEffect.create({ data: { id: id('eff'), requestId, requestVersion: expectedVersion, effectType, idempotencyKey: `${requestId}:${expectedVersion}:${effectType}` } })
        await tx.outboxEvent.create({ data: { id: id('out'), aggregateType: 'REQUEST', aggregateId: requestId, aggregateVersion: expectedVersion, eventType: effectType, safePayload: JSON.stringify({ ...values, timezone: 'Europe/Kyiv' }) } })
      }
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: request.companyId, actorType: 'USER', actorId: principal.userId, action: 'request.approved', entityType: 'REQUEST', entityId: requestId, result: 'SUCCESS', risk: 'HIGH', safeDiffJson: JSON.stringify({ version: expectedVersion }), correlationId: id('corr') } })
    })
    return this.detail(principal, requestId)
  }

  async returnForChanges(principal: AuthPrincipal, requestId: string, expectedVersion: number, comment: string) {
    if (!comment.trim()) throw badRequest('decision_comment_required')
    return this.decideNegative(principal, requestId, expectedVersion, 'RETURNED', comment)
  }

  async reject(principal: AuthPrincipal, requestId: string, expectedVersion: number, comment: string) {
    if (!comment.trim()) throw badRequest('decision_comment_required')
    return this.decideNegative(principal, requestId, expectedVersion, 'REJECTED', comment)
  }

  async cancel(principal: AuthPrincipal, requestId: string, expectedVersion: number) {
    const request = await this.prisma.request.findFirst({ where: { id: requestId, authorId: principal.userId, version: expectedVersion, decisionStatus: { in: ['PENDING', 'RETURNED', 'DRAFT'] } } })
    if (!request) throw conflict()
    await this.prisma.request.update({ where: { id: requestId }, data: { decisionStatus: 'CANCELLED' } })
    return this.detail(principal, requestId)
  }

  private async resubmit(principal: AuthPrincipal, input: AbsenceInput, idempotencyKey: string, approverId: string, startAt: Date, endAt: Date) {
    const request = await this.prisma.request.findFirst({ where: { id: input.requestId, authorId: principal.userId, decisionStatus: 'RETURNED' } })
    if (!request || request.version !== input.expectedVersion) throw conflict()
    const version = request.version + 1
    const values = { type: 'absence', startAt: startAt.toISOString(), endAt: endAt.toISOString(), substituteId: input.substituteId, workdays: this.workdays(startAt, endAt) }
    await this.prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id: request.id }, data: { version, decisionStatus: 'PENDING', executionStatus: 'NOT_STARTED', currentApproverId: approverId, idempotencyKey } })
      await tx.requestSnapshot.create({ data: { id: id('snap'), requestId: request.id, version, valuesJson: JSON.stringify(values), safeSummary: `Відсутність · ${input.startDate} — ${input.endDate}`, authorId: principal.userId } })
      if (input.privateHrComment?.trim()) await tx.requestPrivateDetail.create({ data: { id: id('priv'), requestId: request.id, version, encryptedJson: encryptSecret(JSON.stringify({ comment: input.privateHrComment.trim() })) } })
      await tx.approvalAttempt.create({ data: { id: id('apr'), requestId: request.id, requestVersion: version, approverId, state: 'PENDING', idempotencyKey: `pending:${request.id}:${version}` } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: request.companyId, actorType: 'USER', actorId: principal.userId, action: 'request.resubmitted', entityType: 'REQUEST', entityId: request.id, result: 'SUCCESS', risk: 'NORMAL', safeDiffJson: JSON.stringify({ fromVersion: request.version, toVersion: version }), correlationId: id('corr') } })
    })
    return this.detail(principal, request.id)
  }

  private async decideNegative(principal: AuthPrincipal, requestId: string, expectedVersion: number, state: 'RETURNED' | 'REJECTED', comment: string) {
    const request = await this.prisma.request.findFirst({ where: { id: requestId, currentApproverId: principal.userId, decisionStatus: 'PENDING' } })
    if (!request) throw forbidden()
    if (request.version !== expectedVersion) throw conflict()
    await this.prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id: requestId }, data: { decisionStatus: state } })
      await tx.approvalAttempt.updateMany({ where: { requestId, requestVersion: expectedVersion, approverId: principal.userId, state: 'PENDING' }, data: { state, comment: comment.trim(), decidedAt: new Date() } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: request.companyId, actorType: 'USER', actorId: principal.userId, action: `request.${state.toLowerCase()}`, entityType: 'REQUEST', entityId: requestId, result: 'SUCCESS', risk: 'NORMAL', safeDiffJson: JSON.stringify({ version: expectedVersion }), correlationId: id('corr') } })
    })
    return this.detail(principal, requestId)
  }

  private async mapRows(rows: Array<{ id: string; number: string; companyId: string; authorId: string; typeId: string; currentApproverId: string | null; decisionStatus: string; executionStatus: string; slaDueAt: Date | null; version: number; updatedAt: Date; snapshots: Array<{ safeSummary: string }> }>): Promise<RequestListItem[]> {
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [...new Set(rows.flatMap((row) => [
            row.authorId,
            ...(row.currentApproverId ? [row.currentApproverId] : []),
          ]))],
        },
      },
      select: { id: true, displayName: true },
    })
    const userById = new Map(users.map((user) => [user.id, user]))
    const typeIds = [...new Set(rows.map((row) => row.typeId))]
    const types = await this.prisma.requestType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } })
    const typeById = new Map(types.map((type) => [type.id, type.name]))
    return rows.map((row) => ({ id: row.id, number: row.number, companyId: row.companyId, type: typeById.get(row.typeId) ?? 'Заявка', safeSummary: row.snapshots[0]?.safeSummary ?? 'Чернетка', author: userById.get(row.authorId) ?? null, currentApprover: row.currentApproverId ? userById.get(row.currentApproverId) ?? null : null, decisionStatus: row.decisionStatus as RequestListItem['decisionStatus'], executionStatus: row.executionStatus as RequestListItem['executionStatus'], slaDueAt: row.slaDueAt?.toISOString() ?? null, version: row.version, updatedAt: row.updatedAt.toISOString() }))
  }

  private workdays(start: Date, end: Date): number {
    let days = 0
    const current = new Date(start)
    while (current <= end) {
      const day = current.getUTCDay()
      if (day !== 0 && day !== 6) days += 1
      current.setUTCDate(current.getUTCDate() + 1)
    }
    return days
  }
}
