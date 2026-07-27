import { Injectable } from '@nestjs/common'
import type { Task } from '../../generated/prisma/client.js'
import { notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class TaskAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async readableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    const task = await this.findReadableTask(principal, taskId)
    if (!task) throw notFound()
    return task
  }

  async findReadableTask(principal: AuthPrincipal, taskId: string): Promise<Task | null> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
      },
    })
    if (!task) return null

    if (task.groupId) {
      const membership = await this.prisma.groupMember.findFirst({
        where: {
          groupId: task.groupId,
          userId: principal.userId,
          leftAt: null,
          group: {
            workspaceId: principal.workspaceId,
            companyId: task.companyId,
            status: 'ACTIVE',
          },
        },
        select: { id: true },
      })
      if (!membership) return null
    }

    if (
      task.creatorId === principal.userId
      || task.assigneeId === principal.userId
      || principal.permissions.has('tasks.manage')
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
}
