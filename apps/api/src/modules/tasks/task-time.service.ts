import { Injectable } from '@nestjs/common'
import type { ManualTimeEntryInput, UpdateTimeEntryInput } from '@bert-crm/contracts'
import { Permission } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'

@Injectable()
export class TaskTimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
  ) {}

  async list(principal: AuthPrincipal, taskId: string) {
    await this.access.readableTask(principal, taskId)
    this.assertCanRead(principal)
    const entries = await this.prisma.timeEntry.findMany({
      where: { taskId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarAsset: true,
          },
        },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    })
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        user: entry.user,
        startedAt: entry.startedAt.toISOString(),
        endedAt: entry.endedAt?.toISOString() ?? null,
        durationSeconds: entry.durationSeconds,
        description: entry.description ?? '',
        updatedAt: entry.updatedAt.toISOString(),
      })),
      totalSeconds: entries.reduce(
        (total, entry) => total + (entry.durationSeconds ?? 0),
        0,
      ),
    }
  }

  async addManual(
    principal: AuthPrincipal,
    taskId: string,
    input: ManualTimeEntryInput,
  ) {
    const task = await this.access.readableTask(principal, taskId)
    this.assertCanWrite(principal)
    const startedAt = new Date(input.startedAt)
    const endedAt = new Date(startedAt.getTime() + input.durationSeconds * 1000)
    if (Number.isNaN(startedAt.getTime()) || endedAt > new Date()) {
      throw badRequest('task_time')
    }
    const entry = await this.prisma.timeEntry.create({
      data: {
        id: id('time'),
        taskId,
        userId: principal.userId,
        startedAt,
        endedAt,
        durationSeconds: input.durationSeconds,
        description: input.description || null,
      },
    })
    await this.audit(principal, task.companyId, taskId, 'task.time_added', {
      entryId: entry.id,
      durationSeconds: entry.durationSeconds,
    })
    return this.mapEntry(entry)
  }

  async start(principal: AuthPrincipal, taskId: string, description?: string) {
    const task = await this.access.readableTask(principal, taskId)
    this.assertCanWrite(principal)
    const normalizedDescription = description?.trim() || null
    if (normalizedDescription && normalizedDescription.length > 500) {
      throw badRequest('task_time')
    }
    const active = await this.prisma.timeEntry.findFirst({
      where: { userId: principal.userId, endedAt: null },
      select: { id: true, taskId: true },
    })
    if (active) throw conflict('task_timer_active')
    let entry
    try {
      entry = await this.prisma.timeEntry.create({
        data: {
          id: id('time'),
          taskId,
          userId: principal.userId,
          startedAt: new Date(),
          description: normalizedDescription,
        },
      })
    } catch (error) {
      const concurrent = await this.prisma.timeEntry.findFirst({
        where: { userId: principal.userId, endedAt: null },
        select: { id: true },
      })
      if (concurrent) throw conflict('task_timer_active')
      throw error
    }
    await this.audit(principal, task.companyId, taskId, 'task.timer_started', {
      entryId: entry.id,
    })
    return this.mapEntry(entry)
  }

  async stop(principal: AuthPrincipal, taskId: string) {
    const task = await this.access.readableTask(principal, taskId)
    this.assertCanWrite(principal)
    const active = await this.prisma.timeEntry.findFirst({
      where: {
        taskId,
        userId: principal.userId,
        endedAt: null,
      },
    })
    if (!active) throw notFound()
    const endedAt = new Date()
    const durationSeconds = Math.max(
      1,
      Math.floor((endedAt.getTime() - active.startedAt.getTime()) / 1000),
    )
    const entry = await this.prisma.timeEntry.update({
      where: { id: active.id },
      data: { endedAt, durationSeconds },
    })
    await this.audit(principal, task.companyId, taskId, 'task.timer_stopped', {
      entryId: entry.id,
      durationSeconds,
    })
    return this.mapEntry(entry)
  }

  async update(
    principal: AuthPrincipal,
    taskId: string,
    entryId: string,
    input: UpdateTimeEntryInput,
  ) {
    const task = await this.access.readableTask(principal, taskId)
    this.assertCanWrite(principal)
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, taskId },
    })
    if (!entry) throw notFound()
    this.assertOwnOrManage(principal, entry.userId)
    if (!entry.endedAt || !entry.durationSeconds) throw conflict('task_timer_active')
    if (entry.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw conflict('task_time_version')
    }
    const startedAt = input.startedAt ? new Date(input.startedAt) : entry.startedAt
    const durationSeconds = input.durationSeconds ?? entry.durationSeconds
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000)
    if (Number.isNaN(startedAt.getTime()) || endedAt > new Date()) {
      throw badRequest('task_time')
    }
    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        startedAt,
        endedAt,
        durationSeconds,
        ...(input.description === undefined
          ? {}
          : { description: input.description || null }),
      },
    })
    await this.audit(principal, task.companyId, taskId, 'task.time_updated', {
      entryId,
    })
    return this.mapEntry(updated)
  }

  async remove(principal: AuthPrincipal, taskId: string, entryId: string) {
    const task = await this.access.readableTask(principal, taskId)
    this.assertCanWrite(principal)
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, taskId },
      select: { id: true, userId: true, endedAt: true },
    })
    if (!entry) throw notFound()
    this.assertOwnOrManage(principal, entry.userId)
    if (!entry.endedAt) throw conflict('task_timer_active')
    await this.prisma.timeEntry.delete({ where: { id: entryId } })
    await this.audit(principal, task.companyId, taskId, 'task.time_deleted', {
      entryId,
    })
    return { id: entryId, deleted: true }
  }

  private assertCanRead(principal: AuthPrincipal): void {
    if (
      !principal.permissions.has(Permission.TasksTimeRead)
      && !principal.permissions.has(Permission.TasksManage)
    ) {
      throw forbidden()
    }
  }

  private assertCanWrite(principal: AuthPrincipal): void {
    if (
      !principal.permissions.has(Permission.TasksTimeWrite)
      && !principal.permissions.has(Permission.TasksManage)
    ) {
      throw forbidden()
    }
  }

  private assertOwnOrManage(principal: AuthPrincipal, userId: string): void {
    if (
      userId !== principal.userId
      && !principal.permissions.has(Permission.TasksManage)
    ) {
      throw forbidden()
    }
  }

  private mapEntry(entry: {
    id: string
    userId: string
    startedAt: Date
    endedAt: Date | null
    durationSeconds: number | null
    description: string | null
    updatedAt: Date
  }) {
    return {
      id: entry.id,
      userId: entry.userId,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
      durationSeconds: entry.durationSeconds,
      description: entry.description ?? '',
      updatedAt: entry.updatedAt.toISOString(),
    }
  }

  private async audit(
    principal: AuthPrincipal,
    companyId: string,
    taskId: string,
    action: string,
    safeDiff: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId,
        actorType: 'USER',
        actorId: principal.userId,
        action,
        entityType: 'TASK',
        entityId: taskId,
        result: 'SUCCESS',
        risk: 'NORMAL',
        safeDiffJson: JSON.stringify(safeDiff),
        correlationId: id('corr'),
      },
    })
  }
}
