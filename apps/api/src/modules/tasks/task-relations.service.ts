import { Injectable } from '@nestjs/common'
import type { TaskRelationInput } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { TaskApprovalService } from './task-approval.service.js'
import type { TaskTransaction } from './task-types.js'

interface RelationRow {
  sourceTaskId: string
  targetTaskId: string
  type: TaskRelationInput['type']
}

@Injectable()
export class TaskRelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly approvals: TaskApprovalService,
  ) {}

  async createMany(
    tx: TaskTransaction,
    taskId: string,
    actorId: string,
    relations: TaskRelationInput[],
  ): Promise<void> {
    if (!relations.length) return
    await tx.taskRelation.createMany({
      data: relations.map((relation) => ({
        id: id('trel'),
        ...this.normalize(taskId, relation),
        createdById: actorId,
      })),
    })
  }

  async add(
    principal: AuthPrincipal,
    taskId: string,
    relation: TaskRelationInput,
    expectedVersion: number,
  ): Promise<{ id: string; version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    const row = this.normalize(taskId, relation)
    await this.assertCompatibleTarget(principal, task, relation.targetTaskId)
    if (row.type === 'BLOCKS') await this.assertNoBlockingCycle(row)
    const relationId = id('trel')

    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      await tx.taskRelation.create({
        data: {
          id: relationId,
          ...row,
          createdById: principal.userId,
        },
      })
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'RELATION_ADDED',
      )
      return { id: relationId, version: expectedVersion + 1 }
    })
  }

  async remove(
    principal: AuthPrincipal,
    taskId: string,
    relationId: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      const removed = await tx.taskRelation.deleteMany({
        where: {
          id: relationId,
          OR: [{ sourceTaskId: taskId }, { targetTaskId: taskId }],
        },
      })
      if (!removed.count) throw badRequest('task_relation')
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'RELATION_REMOVED',
      )
      return { version: expectedVersion + 1 }
    })
  }

  private normalize(taskId: string, relation: TaskRelationInput): RelationRow {
    if (relation.targetTaskId === taskId) throw badRequest('task_relation_self')
    if (relation.type === 'BLOCKS') {
      return relation.direction === 'INCOMING'
        ? { sourceTaskId: relation.targetTaskId, targetTaskId: taskId, type: relation.type }
        : { sourceTaskId: taskId, targetTaskId: relation.targetTaskId, type: relation.type }
    }
    const [sourceTaskId, targetTaskId] = [taskId, relation.targetTaskId].sort()
    return { sourceTaskId, targetTaskId, type: relation.type }
  }

  private async assertCompatibleTarget(
    principal: AuthPrincipal,
    task: {
      id: string
      companyId: string
      groupId: string | null
      projectId: string | null
    },
    targetTaskId: string,
  ): Promise<void> {
    const target = await this.prisma.task.findFirst({
      where: {
        id: targetTaskId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        groupId: task.groupId,
        projectId: task.projectId,
        archivedAt: null,
      },
      select: { id: true },
    })
    if (!target) throw badRequest('task_relation_scope')
  }

  private async assertNoBlockingCycle(row: RelationRow): Promise<void> {
    const visited = new Set<string>()
    let frontier = [row.targetTaskId]
    while (frontier.length) {
      if (frontier.includes(row.sourceTaskId)) throw conflict('task_relation_cycle')
      const next = await this.prisma.taskRelation.findMany({
        where: {
          sourceTaskId: { in: frontier },
          type: 'BLOCKS',
        },
        select: { targetTaskId: true },
      })
      frontier = [...new Set(next
        .map((relation) => relation.targetTaskId)
        .filter((taskId) => !visited.has(taskId)))]
      for (const taskId of frontier) visited.add(taskId)
    }
  }

  private assertVersion(version: number): void {
    if (!Number.isInteger(version) || version < 1) throw badRequest('task_version')
  }

  private async advanceVersion(
    tx: TaskTransaction,
    taskId: string,
    expectedVersion: number,
  ): Promise<void> {
    const updated = await tx.task.updateMany({
      where: { id: taskId, version: expectedVersion },
      data: { version: { increment: 1 } },
    })
    if (!updated.count) throw conflict('task_version')
  }
}
