import { Injectable } from '@nestjs/common'
import type { PageResult, TaskListItem } from '@bert-crm/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AuditService } from '../audit/audit.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { JobsService } from '../jobs/jobs.service.js'

export interface CreateTaskInput {
  companyId?: string
  title: string
  description?: string
  assigneeId: string
  deadline?: string
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  related?: { type: string; id: string }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  async list(principal: AuthPrincipal, company: string | undefined, segment = 'mine', page = 1, pageSize = 25, filters: { search?: string; status?: string; priority?: string } = {}): Promise<PageResult<TaskListItem>> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const segmentWhere = segment === 'created' ? { creatorId: principal.userId } : segment === 'all' && principal.permissions.has('tasks.manage') ? {} : { assigneeId: principal.userId }
    const statuses = ['NEW', 'PLANNED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'CANCELLED', 'ARCHIVED'] as const
    const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
    if (filters.status && !statuses.includes(filters.status as typeof statuses[number])) throw badRequest('task_status')
    if (filters.priority && !priorities.includes(filters.priority as typeof priorities[number])) throw badRequest('task_priority')
    const search = filters.search?.trim().slice(0, 100)
    const where: Prisma.TaskWhereInput = {
      companyId: { in: companyIds }, archivedAt: null, ...segmentWhere,
      ...(search ? { OR: [{ title: { contains: search } }, { number: { contains: search } }] } : {}),
      ...(filters.status ? { status: filters.status as typeof statuses[number] } : {}),
      ...(filters.priority ? { priority: filters.priority as typeof priorities[number] } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({ where, orderBy: [{ deadline: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.task.count({ where }),
    ])
    return { items: await this.mapRows(rows), page, pageSize, total }
  }

  async detail(principal: AuthPrincipal, taskId: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, companyId: { in: principal.allowedCompanyIds } }, include: { checklist: { orderBy: { position: 'asc' } } } })
    if (!task) throw notFound()
    const [creator, assignee, comments, links] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: task.creatorId }, select: { id: true, displayName: true } }),
      this.prisma.user.findUnique({ where: { id: task.assigneeId }, select: { id: true, displayName: true, avatarAsset: true } }),
      this.prisma.comment.findMany({ where: { entityType: 'TASK', entityId: task.id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.entityLink.findMany({ where: { OR: [{ sourceType: 'TASK', sourceId: task.id }, { targetType: 'TASK', targetId: task.id }] } }),
    ])
    return { ...task, creator, assignee, comments, links }
  }

  async create(principal: AuthPrincipal, input: CreateTaskInput, idempotencyKey: string): Promise<{ id: string; number: string }> {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    if (!input.title.trim() || input.title.trim().length > 180) throw badRequest('task_title')
    const assignee = await this.prisma.user.findFirst({ where: { id: input.assigneeId, companyAccess: { some: { companyId, status: 'ACTIVE' } }, status: 'ACTIVE' } })
    if (!assignee) throw badRequest('task_assignee')
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { userId_key_operation: { userId: principal.userId, key: idempotencyKey, operation: 'task.create' } } })
    if (existing?.resultId) {
      const task = await this.prisma.task.findUnique({ where: { id: existing.resultId }, select: { id: true, number: true } })
      if (task) return task
    }
    const taskId = id('tsk')
    const number = `TSK-${Date.now().toString().slice(-7)}`
    await this.prisma.$transaction(async (tx) => {
      await tx.task.create({ data: { id: taskId, workspaceId: principal.workspaceId, companyId, number, title: input.title.trim(), description: input.description?.trim() ?? '', creatorId: principal.userId, assigneeId: assignee.id, deadline: input.deadline ? new Date(input.deadline) : null, priority: input.priority ?? 'MEDIUM' } })
      if (input.related) await tx.entityLink.create({ data: { id: id('lnk'), sourceType: 'TASK', sourceId: taskId, targetType: input.related.type, targetId: input.related.id, relation: 'RELATED', createdBy: principal.userId } })
      await tx.idempotencyRecord.create({ data: { id: id('idem'), userId: principal.userId, key: idempotencyKey, operation: 'task.create', requestFingerprint: idempotencyKey, resultType: 'TASK', resultId: taskId, responseStatus: 201, expiresAt: new Date(Date.now() + 86_400_000) } })
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId, action: 'task.created', entityType: 'TASK', entityId: taskId, result: 'SUCCESS', risk: 'NORMAL', correlationId: id('corr') } })
    })
    return { id: taskId, number }
  }

  async changeStatus(principal: AuthPrincipal, taskId: string, status: string, expectedVersion: number): Promise<{ version: number }> {
    const allowed = ['NEW', 'PLANNED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'CANCELLED', 'ARCHIVED']
    if (!allowed.includes(status)) throw badRequest('task_status')
    const task = await this.editableTask(principal, taskId)
    if (task.version !== expectedVersion) throw conflict(`Поточна версія: ${task.version}`)
    const result = await this.prisma.task.updateMany({ where: { id: task.id, version: expectedVersion }, data: { status: status as typeof task.status, version: { increment: 1 }, ...(status === 'ARCHIVED' ? { archivedAt: new Date() } : {}) } })
    if (!result.count) throw conflict()
    await this.audit.record(principal, { action: 'task.status_changed', entityType: 'TASK', entityId: task.id, companyId: task.companyId, safeDiff: { status: { from: task.status, to: status } } })
    return { version: expectedVersion + 1 }
  }

  async addComment(principal: AuthPrincipal, taskId: string, body: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, companyId: { in: principal.allowedCompanyIds } } })
    if (!task) throw notFound()
    const text = body.trim()
    if (!text || text.length > 4000) throw badRequest('comment_body')
    return this.prisma.comment.create({ data: { id: id('cmt'), workspaceId: principal.workspaceId, companyId: task.companyId, entityType: 'TASK', entityId: task.id, authorId: principal.userId, body: text, visibility: 'PARTICIPANTS' } })
  }

  async addChecklistItem(principal: AuthPrincipal, taskId: string, textInput: string) {
    const task = await this.editableTask(principal, taskId)
    const text = textInput.trim()
    if (!text || text.length > 240) throw badRequest('checklist_text')
    const last = await this.prisma.taskChecklistItem.findFirst({ where: { taskId }, orderBy: { position: 'desc' }, select: { position: true } })
    const item = await this.prisma.taskChecklistItem.create({ data: { id: id('chk'), taskId, position: (last?.position ?? 0) + 1, text } })
    await this.audit.record(principal, { action: 'task.checklist_added', entityType: 'TASK', entityId: taskId, companyId: task.companyId, safeDiff: { itemId: item.id } })
    return item
  }

  async updateChecklistItem(principal: AuthPrincipal, taskId: string, itemId: string, input: { isDone: boolean; expectedVersion: number }) {
    const task = await this.editableTask(principal, taskId)
    const item = await this.prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } })
    if (!item) throw notFound()
    if (item.version !== input.expectedVersion) throw conflict()
    const result = await this.prisma.taskChecklistItem.updateMany({ where: { id: item.id, version: input.expectedVersion }, data: { isDone: input.isDone, completedById: input.isDone ? principal.userId : null, completedAt: input.isDone ? new Date() : null, version: { increment: 1 } } })
    if (!result.count) throw conflict()
    await this.audit.record(principal, { action: 'task.checklist_changed', entityType: 'TASK', entityId: taskId, companyId: task.companyId, safeDiff: { itemId, isDone: input.isDone } })
    return { id: item.id, isDone: input.isDone, version: input.expectedVersion + 1 }
  }

  async scheduleRecurrence(principal: AuthPrincipal, taskId: string, input: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; firstOccurrenceAt: string; until?: string }) {
    const task = await this.editableTask(principal, taskId)
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(input.frequency) || !Number.isInteger(input.interval) || input.interval < 1 || input.interval > 365) throw badRequest('task_recurrence')
    const firstOccurrenceAt = new Date(input.firstOccurrenceAt)
    const until = input.until ? new Date(input.until) : undefined
    if (Number.isNaN(firstOccurrenceAt.getTime()) || firstOccurrenceAt <= new Date() || (until && (Number.isNaN(until.getTime()) || until < firstOccurrenceAt))) throw badRequest('task_recurrence_dates')
    const seriesKey = task.recurrenceKey ?? `series:${task.id}`
    if (!task.recurrenceKey) await this.prisma.task.update({ where: { id: task.id }, data: { recurrenceKey: seriesKey } })
    const occurrenceKey = `${seriesKey}:${firstOccurrenceAt.toISOString()}`
    const jobId = await this.jobs.enqueue('task.recurrence', 'TASK', task.id, { seriesKey, frequency: input.frequency, interval: input.interval, occurrenceAt: firstOccurrenceAt.toISOString(), until: until?.toISOString() ?? '' }, `recurrence:${occurrenceKey}`, firstOccurrenceAt)
    await this.audit.record(principal, { action: 'task.recurrence_scheduled', entityType: 'TASK', entityId: task.id, companyId: task.companyId, safeDiff: { frequency: input.frequency, interval: input.interval, firstOccurrenceAt: firstOccurrenceAt.toISOString(), until: until?.toISOString() } })
    return { jobId, seriesKey, nextOccurrenceAt: firstOccurrenceAt.toISOString() }
  }

  private async editableTask(principal: AuthPrincipal, taskId: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, companyId: { in: principal.allowedCompanyIds } } })
    if (!task) throw notFound()
    if (task.creatorId !== principal.userId && task.assigneeId !== principal.userId && !principal.permissions.has('tasks.manage')) throw notFound()
    return task
  }

  private async mapRows(rows: Array<{ id: string; number: string; companyId: string; title: string; assigneeId: string; status: string; priority: string; deadline: Date | null; version: number }>): Promise<TaskListItem[]> {
    const assignees = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.assigneeId))] } }, select: { id: true, displayName: true, avatarAsset: true } })
    const byId = new Map(assignees.map((user) => [user.id, user]))
    const counts = rows.length ? await this.prisma.comment.groupBy({ by: ['entityId'], where: { entityType: 'TASK', entityId: { in: rows.map((row) => row.id) }, deletedAt: null }, _count: { id: true } }) : []
    const commentCount = new Map(counts.map((entry) => [entry.entityId, entry._count.id]))
    return rows.map((row) => ({
      id: row.id, number: row.number, companyId: row.companyId, title: row.title,
      assignee: byId.get(row.assigneeId) ?? { id: row.assigneeId, displayName: 'Недоступний користувач', avatarAsset: null },
      status: row.status as TaskListItem['status'], priority: row.priority as TaskListItem['priority'],
      deadline: row.deadline?.toISOString() ?? null, version: row.version, commentCount: commentCount.get(row.id) ?? 0, attachmentCount: 0,
    }))
  }
}
