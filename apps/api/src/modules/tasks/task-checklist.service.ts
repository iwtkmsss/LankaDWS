import { notifyTaskParticipants } from './task-notifications.js'
import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { assertTaskRestoreAllowed } from './task-restore-policy.js'
import type { TaskTransaction } from './task-types.js'

@Injectable()
export class TaskChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
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
    await this.access.editableTask(principal, taskId)
    const normalizedTitle = typeof title === 'string' ? title.trim() : ''
    if (!normalizedTitle || normalizedTitle.length > 300) throw badRequest('task_checklist')
    this.assertVersion(expectedVersion)
    const itemId = id('tcheck')

    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      // Hidden items keep their positions, so allocate after every row.
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
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.checklist_changed', { detail: `Чекліст: додано «${normalizedTitle}»` })
      return { id: itemId, version: expectedVersion + 1 }
    })
  }

  async update(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    input: { title?: string; isCompleted?: boolean; expectedVersion: number },
  ): Promise<{ version: number }> {
    await this.access.editableTask(principal, taskId)
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
        where: { id: itemId, taskId, deletedAt: null },
        select: { title: true, isCompleted: true },
      })
      if (!existing) throw badRequest('task_checklist')
      const updated = await tx.taskChecklistItem.updateMany({
        where: { id: itemId, taskId, deletedAt: null },
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
      await notifyTaskParticipants(tx, taskId, principal.userId, input.expectedVersion + 1, 'task.checklist_changed', { detail: `${input.isCompleted === undefined ? 'Чекліст: змінено пункт' : input.isCompleted ? 'Чекліст: виконано' : 'Чекліст: повернуто до виконання'} «${title ?? existing.title}»` })
      return { version: input.expectedVersion + 1 }
    })
  }

  async remove(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      // Content is hidden, never deleted (decision 2026-11-18). The hidden item
      // keeps its position: visible order is unchanged and a restore can put it
      // back in place without colliding with @@unique([taskId, position]).
      const removed = await tx.taskChecklistItem.updateMany({
        where: { id: itemId, taskId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: principal.userId, version: { increment: 1 } },
      })
      if (!removed.count) throw badRequest('task_checklist')
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.checklist_changed', { detail: 'Чекліст: вилучено пункт' })
      return { version: expectedVersion + 1 }
    })
  }

  /** Brings a hidden item back at the position it kept (decision 2026-11-18). */
  async restore(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    await this.access.readableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    const item = await this.prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
      select: { title: true, deletedAt: true, deletedById: true },
    })
    if (!item) throw notFound()
    if (!item.deletedAt) throw conflict('task_checklist_not_hidden')
    assertTaskRestoreAllowed(principal, item.deletedById, item.deletedAt)
    return this.prisma.$transaction(async (tx) => {
      await this.advanceVersion(tx, taskId, expectedVersion)
      const restored = await tx.taskChecklistItem.updateMany({
        where: { id: itemId, taskId, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null, version: { increment: 1 } },
      })
      if (!restored.count) throw conflict('task_checklist_not_hidden')
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.checklist_changed', { detail: `Чекліст: відновлено «${item.title}»` })
      return { version: expectedVersion + 1 }
    })
  }

  async reorder(
    principal: AuthPrincipal,
    taskId: string,
    itemIds: string[],
    expectedVersion: number,
  ): Promise<{ version: number }> {
    await this.access.editableTask(principal, taskId)
    this.assertVersion(expectedVersion)
    if (
      !Array.isArray(itemIds)
      || itemIds.some((itemId) => typeof itemId !== 'string')
      || new Set(itemIds).size !== itemIds.length
    ) {
      throw badRequest('task_checklist_order')
    }
    const existing = await this.prisma.taskChecklistItem.findMany({
      where: { taskId, deletedAt: null },
      select: { id: true, position: true },
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
      // Reuse the visible items' own position slots; hidden items keep theirs.
      await this.reposition(tx, itemIds, existing.map((item) => item.position))
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.checklist_changed', { detail: 'Чекліст: змінено порядок пунктів' })
      return { version: expectedVersion + 1 }
    })
  }

  /**
   * Assigns `slots` (ascending positions already owned by these items) in the
   * order of `itemIds`. Moving through negative temporaries avoids transient
   * collisions with @@unique([taskId, position]); positions are never negative
   * otherwise, so hidden items are never touched.
   */
  private async reposition(tx: TaskTransaction, itemIds: string[], slots: number[]): Promise<void> {
    for (const [index, itemId] of itemIds.entries()) {
      await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: { position: -(index + 1) },
      })
    }
    for (const [index, itemId] of itemIds.entries()) {
      await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: { position: slots[index] },
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
