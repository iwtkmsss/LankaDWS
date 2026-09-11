import { Injectable } from '@nestjs/common'
import type { TaskOption } from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'

@Injectable()
export class TaskHierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
  ) {}

  async tree(
    principal: AuthPrincipal,
    selectedTaskId: string,
  ): Promise<{ rootId: string; items: TaskOption[] }> {
    const selectedTask = await this.access.readableTask(principal, selectedTaskId)
    const items = await this.prisma.task.findMany({
      where: {
        workspaceId: principal.workspaceId,
        companyId: selectedTask.companyId,
        groupId: selectedTask.groupId,
        projectId: selectedTask.projectId,
        archivedAt: null,
        ...(isGlobalAdmin(principal)
          ? {}
          : {
              OR: [
                { createdById: principal.userId },
                { reporterId: principal.userId },
                {
                  participants: {
                    some: { userId: principal.userId, removedAt: null },
                  },
                },
              ],
            }),
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        groupId: true,
        projectId: true,
        parentTaskId: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const byId = new Map(items.map((item) => [item.id, item]))
    const childrenByParent = new Map<string, string[]>()
    for (const item of items) {
      if (!item.parentTaskId) continue
      const children = childrenByParent.get(item.parentTaskId) ?? []
      children.push(item.id)
      childrenByParent.set(item.parentTaskId, children)
    }
    let root = byId.get(selectedTask.id)
    if (!root) return { rootId: selectedTask.id, items: [] }

    const visited = new Set<string>()
    while (root.parentTaskId && byId.has(root.parentTaskId) && !visited.has(root.id)) {
      visited.add(root.id)
      root = byId.get(root.parentTaskId)!
    }

    const included = new Set<string>()
    const queue = [root.id]
    while (queue.length) {
      const taskId = queue.shift()!
      if (included.has(taskId)) continue
      included.add(taskId)
      queue.push(...(childrenByParent.get(taskId) ?? []))
    }

    return {
      rootId: root.id,
      items: items.filter((item) => included.has(item.id)),
    }
  }

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
