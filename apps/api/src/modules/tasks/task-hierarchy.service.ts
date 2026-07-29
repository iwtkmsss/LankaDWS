import { Injectable } from '@nestjs/common'
import { badRequest } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Injectable()
export class TaskHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async assertValidParent(
    principal: AuthPrincipal,
    task: {
      id: string
      companyId: string
      groupId: string | null
      projectId: string | null
    },
    parentTaskId: string | null,
  ): Promise<void> {
    const children = await this.prisma.task.findMany({
      where: {
        parentTaskId: task.id,
        archivedAt: null,
      },
      select: {
        id: true,
        groupId: true,
        projectId: true,
      },
    })
    if (children.some((child) => (
      child.groupId !== task.groupId || child.projectId !== task.projectId
    ))) {
      throw badRequest('task_subtask_scope')
    }
    if (!parentTaskId) return
    if (parentTaskId === task.id) throw badRequest('task_parent_cycle')

    let cursor: string | null = parentTaskId
    const visited = new Set<string>()
    while (cursor) {
      if (cursor === task.id || visited.has(cursor)) throw badRequest('task_parent_cycle')
      visited.add(cursor)
      const parent: {
        id: string
        parentTaskId: string | null
        groupId: string | null
        projectId: string | null
      } | null = await this.prisma.task.findFirst({
        where: {
          id: cursor,
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          archivedAt: null,
        },
        select: {
          id: true,
          parentTaskId: true,
          groupId: true,
          projectId: true,
        },
      })
      if (!parent) throw badRequest('task_parent')
      if (parent.groupId !== task.groupId || parent.projectId !== task.projectId) {
        throw badRequest('task_parent_scope')
      }
      cursor = parent.parentTaskId
    }
  }
}
