import { Injectable } from '@nestjs/common'
import type { TaskOption } from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import type { Prisma } from '../../generated/prisma/client.js'

/** Parent IDs per `parentTaskId IN (...)` query; keeps SQLite bound-variable counts small. */
const hierarchyBatchSize = 500
const nodeSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  projectId: true,
  parentTaskId: true,
  createdAt: true,
  workspaceId: true,
  companyId: true,
  archivedAt: true,
  createdById: true,
  reporterId: true,
} satisfies Prisma.TaskSelect
type NodeRow = Prisma.TaskGetPayload<{ select: typeof nodeSelect }>

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
    const globalAdmin = isGlobalAdmin(principal)
    // A tree node must be in the selected task's workspace/company/project, not archived, and readable:
    // created by, reported by or an active participant (removedAt null) for the principal; admins read all.
    //
    // The predicate is evaluated here instead of in the SQL WHERE on purpose: SQLite has no sqlite_stat1 and,
    // given `workspaceId = ? AND ... AND id/parentTaskId IN (...)`, it plans on the workspace index and walks
    // the whole company. Queries below therefore filter only by id / parentTaskId (PK / parentTaskId index).
    const inScope = (row: NodeRow) => row.workspaceId === principal.workspaceId
      && row.companyId === selectedTask.companyId
      && row.projectId === selectedTask.projectId
      && row.archivedAt === null
    const readableWithoutParticipation = (row: NodeRow) => globalAdmin
      || row.createdById === principal.userId
      || row.reporterId === principal.userId
    /** Keeps the in-scope rows that are readable, checking active participation only where needed. */
    const readableNodes = async (rows: NodeRow[]): Promise<NodeRow[]> => {
      const scoped = rows.filter(inScope)
      const needParticipation = scoped.filter((row) => !readableWithoutParticipation(row)).map((row) => row.id)
      const participating = new Set<string>()
      for (let offset = 0; offset < needParticipation.length; offset += hierarchyBatchSize) {
        const participants = await this.prisma.taskParticipant.findMany({
          where: {
            userId: principal.userId,
            removedAt: null,
            taskId: { in: needParticipation.slice(offset, offset + hierarchyBatchSize) },
          },
          select: { taskId: true },
        })
        for (const participant of participants) participating.add(participant.taskId)
      }
      return scoped.filter((row) => readableWithoutParticipation(row) || participating.has(row.id))
    }
    const findNode = async (id: string): Promise<NodeRow | null> => {
      const row = await this.prisma.task.findUnique({ where: { id }, select: nodeSelect })
      return row ? (await readableNodes([row]))[0] ?? null : null
    }

    let root = await findNode(selectedTask.id)
    if (!root) return { rootId: selectedTask.id, items: [] }

    // Walk up while the parent is itself a readable in-scope node; stop on the first revisited node.
    const visited = new Set<string>()
    while (root.parentTaskId && !visited.has(root.id)) {
      const parent = await findNode(root.parentTaskId)
      if (!parent) break
      visited.add(root.id)
      root = parent
    }

    // Walk down level by level through readable in-scope children only; unreadable nodes cut their subtree.
    const included = new Map<string, NodeRow>([[root.id, root]])
    let frontier = [root.id]
    while (frontier.length) {
      const next: string[] = []
      for (let offset = 0; offset < frontier.length; offset += hierarchyBatchSize) {
        const candidates = await this.prisma.task.findMany({
          where: { parentTaskId: { in: frontier.slice(offset, offset + hierarchyBatchSize) } },
          select: nodeSelect,
        })
        for (const child of await readableNodes(candidates.filter((candidate) => !included.has(candidate.id)))) {
          if (included.has(child.id)) continue
          included.set(child.id, child)
          next.push(child.id)
        }
      }
      frontier = next
    }

    const items = [...included.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((item) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        status: item.status,
        projectId: item.projectId,
        parentTaskId: item.parentTaskId,
      }))
    return { rootId: root.id, items }
  }

  async assertValidParent(
    principal: AuthPrincipal,
    task: {
      id: string
      companyId: string
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
        projectId: true,
      },
    })
    if (children.some((child) => (
      child.projectId !== task.projectId
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
          projectId: true,
        },
      })
      if (!parent) throw badRequest('task_parent')
      if (parent.projectId !== task.projectId) {
        throw badRequest('task_parent_scope')
      }
      cursor = parent.parentTaskId
    }
  }
}
