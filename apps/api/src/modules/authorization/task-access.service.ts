import { Injectable } from '@nestjs/common'
import type { Task } from '../../generated/prisma/client.js'
import { notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class TaskAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async readableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    const task = await this.findReadableTask(principal, taskId)
    if (!task) throw notFound()
    return task
  }

  async editableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    const task = await this.findReadableTask(principal, taskId)
    if (!task || !await this.canEdit(principal, task)) throw notFound()
    return task
  }

  async findReadableTask(principal: AuthPrincipal, taskId: string): Promise<Task | null> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId: principal.workspaceId,
      },
    })
    if (!task) return null

    if (
      task.createdById === principal.userId
      || task.reporterId === principal.userId
      || isGlobalAdmin(principal)
    ) {
      return task
    }

    const participant = await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId: principal.userId,
        removedAt: null,
      },
      select: { id: true },
    })
    return participant ? task : null
  }

  private async canEdit(principal: AuthPrincipal, task: Task): Promise<boolean> {
    if (
      task.createdById === principal.userId
      || task.reporterId === principal.userId
      || isGlobalAdmin(principal)
    ) {
      return true
    }

    return Boolean(await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId: principal.userId,
        role: { in: ['RESPONSIBLE', 'COLLABORATOR'] },
        removedAt: null,
      },
      select: { id: true },
    }))
  }
}
