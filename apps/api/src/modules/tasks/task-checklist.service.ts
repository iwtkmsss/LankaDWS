import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { TaskApprovalService } from './task-approval.service.js'
import type { TaskTransaction } from './task-types.js'

@Injectable()
export class TaskChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly approvals: TaskApprovalService,
  ) {}

  async createMany(
    tx: TaskTransaction,
    taskId: string,
    items: Array<{ clientId: string; title: string; isCompleted: boolean }>,
  ): Promise<Record<string, string>> {
    if (!items.length) return {}
    const rows = items.map((item, position) => ({
      id: id('tcheck'),
      taskId,
      title: item.title,
      isCompleted: item.isCompleted,
      position,
      ...(item.isCompleted ? { completedAt: new Date() } : {}),
    }))
    await tx.taskChecklistItem.createMany({
      data: rows,
    })
    return Object.fromEntries(items.map((item, index) => [item.clientId, rows[index].id]))
  }

  async add(
    principal: AuthPrincipal,
    taskId: string,
    title: string,
    expectedVersion: number,
  ): Promise<{ id: string; version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    const normalizedTitle = typeof title === 'string' ? title.trim() : ''
    if (!normalizedTitle || normalizedTitle.length > 300) throw badRequest('task_checklist')
    this.assertVersion(expectedVersion)
    const itemId = id('tcheck')

    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      const last = await tx.taskChecklistItem.findFirst({
        where: { taskId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      await tx.taskChecklistItem.create({
        data: {
          id: itemId,
          taskId,
          title: normalizedTitle,
          position: (last?.position ?? -1) + 1,
        },
      })
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'CHECKLIST_ITEM_ADDED',
      )
      return { id: itemId, version: expectedVersion + 1 }
    })
  }

  async update(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    input: { title?: string; isCompleted?: boolean; expectedVersion: number },
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertVersion(input.expectedVersion)
    if (input.title === undefined && input.isCompleted === undefined) {
      throw badRequest('task_checklist')
    }
    const title = input.title?.trim()
    if (input.title !== undefined && (!title || title.length > 300)) {
      throw badRequest('task_checklist')
    }

    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, input.expectedVersion)
      const existing = await tx.taskChecklistItem.findFirst({
        where: { id: itemId, taskId },
        select: { title: true, isCompleted: true },
      })
      if (!existing) throw badRequest('task_checklist')
      const updated = await tx.taskChecklistItem.updateMany({
        where: { id: itemId, taskId },
        data: {
          ...(title ? { title } : {}),
          ...(input.isCompleted === undefined
            ? {}
            : {
                isCompleted: input.isCompleted,
                completedById: input.isCompleted ? principal.userId : null,
                completedAt: input.isCompleted ? new Date() : null,
              }),
          version: { increment: 1 },
        },
      })
      if (!updated.count) throw badRequest('task_checklist')
      if (
        (title !== undefined && title !== existing.title)
        || (input.isCompleted !== undefined && input.isCompleted !== existing.isCompleted)
      ) {
        await this.approvals.invalidatePending(
          tx,
          principal,
          task,
          input.expectedVersion + 1,
          'CHECKLIST_ITEM_UPDATED',
        )
      }
      return { version: input.expectedVersion + 1 }
    })
  }

  async remove(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      const removed = await tx.taskChecklistItem.deleteMany({
        where: { id: itemId, taskId },
      })
      if (!removed.count) throw badRequest('task_checklist')
      const remaining = await tx.taskChecklistItem.findMany({
        where: { taskId },
        orderBy: { position: 'asc' },
        select: { id: true },
      })
      await this.reposition(tx, remaining.map((item) => item.id))
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'CHECKLIST_ITEM_REMOVED',
      )
      return { version: expectedVersion + 1 }
    })
  }

  async reorder(
    principal: AuthPrincipal,
    taskId: string,
    itemIds: string[],
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    if (
      !Array.isArray(itemIds)
      || itemIds.some((itemId) => typeof itemId !== 'string')
      || new Set(itemIds).size !== itemIds.length
    ) {
      throw badRequest('task_checklist_order')
    }
    const existing = await this.prisma.taskChecklistItem.findMany({
      where: { taskId },
      select: { id: true },
      orderBy: { position: 'asc' },
    })
    if (
      existing.length !== itemIds.length
      || existing.some((item) => !itemIds.includes(item.id))
    ) {
      throw badRequest('task_checklist_order')
    }

    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      await this.reposition(tx, itemIds)
      if (existing.some((item, position) => item.id !== itemIds[position])) {
        await this.approvals.invalidatePending(
          tx,
          principal,
          task,
          expectedVersion + 1,
          'CHECKLIST_REORDERED',
        )
      }
      return { version: expectedVersion + 1 }
    })
  }

  private async reposition(tx: TaskTransaction, itemIds: string[]): Promise<void> {
    for (const [position, itemId] of itemIds.entries()) {
      await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: { position: -(position + 1) },
      })
    }
    for (const [position, itemId] of itemIds.entries()) {
      await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: { position },
      })
    }
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

  private assertVersion(version: number): void {
    if (!Number.isInteger(version) || version < 1) throw badRequest('task_version')
  }
}
