import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

interface StartInput { companyId?: string; employeeId: string; processType: 'ONBOARDING' | 'OFFBOARDING'; startAt: string; endAt?: string }

@Injectable()
export class LifecycleService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async list(principal: AuthPrincipal, company?: string) {
    const rows = await this.prisma.lifecycleProcess.findMany({ where: { companyId: { in: this.scope.allowedCompanies(principal, company) } }, include: { steps: true }, orderBy: { updatedAt: 'desc' } })
    return { items: rows }
  }

  async detail(principal: AuthPrincipal, processId: string) {
    const process = await this.prisma.lifecycleProcess.findFirst({ where: { id: processId, companyId: { in: principal.allowedCompanyIds } }, include: { steps: { orderBy: { dueAt: 'asc' } } } })
    if (!process) throw notFound()
    const employee = await this.prisma.user.findUnique({ where: { id: process.employeeId }, select: { id: true, displayName: true, jobTitle: true, avatarAsset: true, approverId: true } })
    return { ...process, employee }
  }

  async start(principal: AuthPrincipal, input: StartInput) {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    const employee = await this.prisma.user.findFirst({ where: { id: input.employeeId, companyAccess: { some: { companyId, status: 'ACTIVE' } } } })
    if (!employee) throw badRequest('employee_invalid')
    const processId = id('life')
    const startAt = new Date(input.startAt)
    const definitions = input.processType === 'ONBOARDING' ? [
      ['HR', 'Підготувати профіль і документи', principal.userId, 0],
      ['IT', 'Створити облікові записи й доступи', principal.userId, 1],
      ['APPROVER', 'Підготувати перші задачі', employee.approverId ?? principal.userId, 2],
      ['EMPLOYEE', 'Підтвердити ознайомлення', employee.id, 3],
    ] as const : [
      ['APPROVER', 'Передати активні задачі й документи', employee.approverId ?? principal.userId, 0],
      ['IT', 'Завершити сесії та доступи', principal.userId, 1],
      ['HR', 'Оформити фінальні документи', principal.userId, 2],
    ] as const
    await this.prisma.$transaction(async (tx) => {
      await tx.lifecycleProcess.create({ data: { id: processId, workspaceId: principal.workspaceId, companyId, employeeId: employee.id, processType: input.processType, templateVersion: 1, ownerId: principal.userId, startAt, endAt: input.endAt ? new Date(input.endAt) : null, status: 'IN_PROGRESS' } })
      for (const [key, title, ownerId, offset] of definitions) {
        const taskId = id('tsk')
        await tx.task.create({ data: { id: taskId, workspaceId: principal.workspaceId, companyId, number: `TSK-${Date.now().toString().slice(-5)}${offset}`, title, creatorId: principal.userId, assigneeId: ownerId, status: 'PLANNED', priority: offset === 0 ? 'HIGH' : 'MEDIUM', deadline: new Date(startAt.getTime() + offset * 86_400_000) } })
        await tx.lifecycleStep.create({ data: { id: id('step'), processId, sourceKey: key, linkedTaskId: taskId, ownerId, status: 'PLANNED', dueAt: new Date(startAt.getTime() + offset * 86_400_000) } })
        await tx.entityLink.create({ data: { id: id('lnk'), sourceType: 'LIFECYCLE', sourceId: processId, targetType: 'TASK', targetId: taskId, relation: 'STEP', createdBy: principal.userId } })
      }
      await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId, actorType: 'USER', actorId: principal.userId, action: `lifecycle.${input.processType.toLowerCase()}.started`, entityType: 'LIFECYCLE', entityId: processId, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    })
    return this.detail(principal, processId)
  }

  async complete(principal: AuthPrincipal, processId: string, expectedVersion: number, ownershipTransferred: boolean) {
    const process = await this.prisma.lifecycleProcess.findFirst({ where: { id: processId, companyId: { in: principal.allowedCompanyIds } }, include: { steps: true } })
    if (!process) throw notFound()
    if (process.version !== expectedVersion) throw conflict()
    const incomplete = process.steps.filter((step) => step.status !== 'DONE')
    if (incomplete.length || (process.processType === 'OFFBOARDING' && !ownershipTransferred)) throw badRequest('lifecycle_blocked', 'Критичні кроки або передача власності ще не завершені.')
    await this.prisma.$transaction(async (tx) => {
      await tx.lifecycleProcess.update({ where: { id: process.id }, data: { status: 'DONE', progress: 100, version: { increment: 1 } } })
      if (process.processType === 'OFFBOARDING') {
        await tx.userSession.updateMany({ where: { userId: process.employeeId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'offboarding' } })
        await tx.user.update({ where: { id: process.employeeId }, data: { status: 'DEACTIVATED', authorizationVersion: { increment: 1 } } })
      }
    })
    return { completed: true }
  }
}
