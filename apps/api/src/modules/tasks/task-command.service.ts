import { Injectable } from '@nestjs/common'
import type { CreateTaskInput, UpdateTaskInput } from '@bert-crm/contracts'
import { id, sha256 } from '../../common/crypto.js'
import { badRequest, conflict, forbidden } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskNumberAllocator } from '../../prisma/task-number-allocator.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FeedProjectionService } from '../feed/feed-projection.service.js'
import { TaskAttachmentsService } from './task-attachments.service.js'
import { TaskApprovalService } from './task-approval.service.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskHierarchyService } from './task-hierarchy.service.js'
import { TaskParticipantsService } from './task-participants.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskRecurrenceService } from './task-recurrence.service.js'
import { TaskReminderService } from './task-reminder.service.js'
import { TaskValidationService } from './task-validation.service.js'

@Injectable()
export class TaskCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskNumbers: TaskNumberAllocator,
    private readonly access: TaskAccessService,
    private readonly validation: TaskValidationService,
    private readonly hierarchy: TaskHierarchyService,
    private readonly participants: TaskParticipantsService,
    private readonly checklist: TaskChecklistService,
    private readonly relations: TaskRelationsService,
    private readonly reminders: TaskReminderService,
    private readonly recurrence: TaskRecurrenceService,
    private readonly attachments: TaskAttachmentsService,
    private readonly feedProjection: FeedProjectionService,
    private readonly approvals: TaskApprovalService,
  ) {}

  async create(
    principal: AuthPrincipal,
    input: CreateTaskInput,
    idempotencyKey: string,
    options: { expectedParentVersion?: number } = {},
  ): Promise<{
    id: string
    number: string
    version: number
  }> {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw badRequest('idempotency_key_required')
    }
    const context = await this.validation.validateCreate(principal, input)
    const operation = 'task.create.v2'
    const requestFingerprint = sha256(JSON.stringify({ operation, input }))
    const existing = await this.idempotentResult(
      principal.userId,
      idempotencyKey,
      operation,
      requestFingerprint,
    )
    if (existing) return existing
    const [timezone, attachmentIds] = await Promise.all([
      input.recurrence
        ? this.recurrence.timezoneFor(context.reporterId)
        : Promise.resolve(null),
      this.attachments.validateStaged(
        principal,
        context.companyId,
        input.attachmentIds,
      ),
    ])

    const taskId = id('tsk')
    const number = await this.taskNumbers.runInTransaction(
      this.prisma,
      async (tx, allocatedNumber) => {
      const task = await tx.task.create({
        data: {
          id: taskId,
          workspaceId: principal.workspaceId,
          companyId: context.companyId,
          groupId: context.groupId,
          projectId: context.projectId,
          parentTaskId: context.parentTaskId,
          number: allocatedNumber,
          title: input.title,
          description: input.description,
          createdById: principal.userId,
          reporterId: context.reporterId,
          priority: input.priority,
          startsAt: context.startsAt,
          dueAt: context.dueAt,
          estimatedMinutes: input.estimatedMinutes ?? null,
        },
      })
      await this.participants.createMany(tx, taskId, principal.userId, context.participants)
      await this.checklist.createMany(
        tx,
        taskId,
        input.checklistItems,
      )
      if (context.tagIds.length) {
        await tx.taskTag.createMany({
          data: context.tagIds.map((tagId) => ({ taskId, tagId })),
        })
      }
      await this.relations.createMany(tx, taskId, principal.userId, context.relations)
      await this.reminders.createMany(
        tx,
        taskId,
        { startsAt: context.startsAt, dueAt: context.dueAt },
        context.participants.map((participant) => participant.userId),
        input.reminders,
      )
      if (input.recurrence && timezone) {
        const maximumReminderOffsetMinutes = Math.max(
          0,
          ...input.reminders.map((reminder) => (
            reminder.trigger.type === 'AT' ? 0 : reminder.trigger.offsetMinutes
          )),
        )
        await this.recurrence.create(
          tx,
          taskId,
          input.recurrence,
          timezone,
          maximumReminderOffsetMinutes,
        )
      }
      await this.attachments.linkMany(tx, taskId, attachmentIds)
      const feedItemId = await this.feedProjection.projectTask(tx, task, {
        action: 'ASSIGNED',
        actorId: principal.userId,
        recipientIds: context.participants.map((participant) => participant.userId),
      })
      if (context.parentTaskId) {
        const parentUpdate = await tx.task.updateMany({
          where: {
            id: context.parentTaskId,
            ...(options.expectedParentVersion === undefined
              ? {}
              : { version: options.expectedParentVersion }),
          },
          data: { version: { increment: 1 } },
        })
        if (!parentUpdate.count) throw conflict('task_version')
        const [parent, parentParticipants] = await Promise.all([
          tx.task.findUniqueOrThrow({ where: { id: context.parentTaskId } }),
          tx.taskParticipant.findMany({
            where: { taskId: context.parentTaskId, removedAt: null },
            select: { userId: true },
          }),
        ])
        await this.approvals.invalidatePending(
          tx,
          principal,
          parent,
          parent.version,
          'SUBTASK_CREATED',
        )
        const versionedParent = await tx.task.findUniqueOrThrow({
          where: { id: context.parentTaskId },
        })
        const parentFeedItemId = await this.feedProjection.projectTask(tx, versionedParent, {
          action: 'SUBTASK_CREATED',
          actorId: principal.userId,
          recipientIds: parentParticipants.map((participant) => participant.userId),
        })
        await tx.auditEvent.create({
          data: {
            id: id('aud'),
            workspaceId: principal.workspaceId,
            companyId: context.companyId,
            actorType: 'USER',
            actorId: principal.userId,
            action: 'task.subtask_created',
            entityType: 'TASK',
            entityId: context.parentTaskId,
            result: 'SUCCESS',
            risk: 'NORMAL',
            safeDiffJson: JSON.stringify({ subtaskId: taskId }),
            correlationId: id('corr'),
          },
        })
        await tx.outboxEvent.create({
          data: {
            id: id('out'),
            aggregateType: 'TASK',
            aggregateId: context.parentTaskId,
            aggregateVersion: versionedParent.version,
            eventType: 'task.subtask_created',
            safePayload: JSON.stringify({
              taskId: context.parentTaskId,
              subtaskId: taskId,
              companyId: context.companyId,
              actorId: principal.userId,
              feedItemId: parentFeedItemId,
            }),
          },
        })
      }
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'TASK',
          resultId: taskId,
          responseStatus: 201,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: context.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.created',
          entityType: 'TASK',
          entityId: taskId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({
            participantCount: context.participants.length,
            checklistCount: input.checklistItems.length,
            relationCount: context.relations.length,
            reminderCount: input.reminders.length,
            attachmentCount: attachmentIds.length,
            recurrence: Boolean(input.recurrence),
          }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: taskId,
          aggregateVersion: task.version,
          eventType: 'task.created',
          safePayload: JSON.stringify({
            taskId,
            companyId: context.companyId,
            actorId: principal.userId,
            feedItemId,
          }),
        },
      })
        return allocatedNumber
      },
    )
    return { id: taskId, number, version: 1 }
  }

  async update(
    principal: AuthPrincipal,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<{ id: string; version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    const dates = this.validation.validateUpdateDates(task, input)
    const scope = await this.validation.validateUpdateScope(principal, task, input)
    const nextParentTaskId = input.parentTaskId === undefined ? task.parentTaskId : input.parentTaskId
    const changedFields = [
      ...(input.title !== undefined && input.title !== task.title ? ['title'] : []),
      ...(input.description !== undefined && input.description !== task.description ? ['description'] : []),
      ...(input.groupId !== undefined && input.groupId !== task.groupId ? ['groupId'] : []),
      ...(input.projectId !== undefined && input.projectId !== task.projectId ? ['projectId'] : []),
      ...(input.parentTaskId !== undefined && input.parentTaskId !== task.parentTaskId ? ['parentTaskId'] : []),
      ...(input.reporterId !== undefined && scope.reporterId !== task.reporterId ? ['reporterId'] : []),
      ...(input.priority !== undefined && input.priority !== task.priority ? ['priority'] : []),
      ...(input.startsAt !== undefined && dates.startsAt?.getTime() !== task.startsAt?.getTime() ? ['startsAt'] : []),
      ...(input.dueAt !== undefined && dates.dueAt?.getTime() !== task.dueAt?.getTime() ? ['dueAt'] : []),
      ...(input.estimatedMinutes !== undefined && input.estimatedMinutes !== task.estimatedMinutes
        ? ['estimatedMinutes']
        : []),
    ]

    if (input.groupId !== undefined || input.projectId !== undefined || input.parentTaskId !== undefined) {
      await this.hierarchy.assertValidParent(principal, {
        id: task.id,
        companyId: task.companyId,
        groupId: scope.groupId,
        projectId: scope.projectId,
      }, nextParentTaskId)
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: taskId, version: input.expectedVersion },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
          ...(input.reporterId === undefined ? {} : { reporterId: input.reporterId }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.startsAt === undefined ? {} : { startsAt: dates.startsAt }),
          ...(input.dueAt === undefined ? {} : { dueAt: dates.dueAt }),
          ...(input.estimatedMinutes === undefined
            ? {}
            : { estimatedMinutes: input.estimatedMinutes }),
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict('task_version')
      if (changedFields.length) {
        await this.approvals.invalidatePending(
          tx,
          principal,
          task,
          input.expectedVersion + 1,
          'TASK_UPDATED',
        )
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.updated',
          entityType: 'TASK',
          entityId: taskId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          safeDiffJson: JSON.stringify({ fields: changedFields }),
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: taskId,
          aggregateVersion: input.expectedVersion + 1,
          eventType: 'task.updated',
          safePayload: JSON.stringify({ taskId, actorId: principal.userId }),
        },
      })
      return { id: taskId, version: input.expectedVersion + 1 }
    })
    return updated
  }

  async archive(
    principal: AuthPrincipal,
    taskId: string,
    expectedVersion: number,
  ): Promise<{ id: string; version: number }> {
    const task = await this.access.readableTask(principal, taskId)
    if (
      task.createdById !== principal.userId
      && task.reporterId !== principal.userId
      && !isGlobalAdmin(principal)
    ) {
      throw forbidden()
    }
    await this.approvals.assertNoPending(task.id)
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion, archivedAt: null },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict('task_version')
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.archived',
          entityType: 'TASK',
          entityId: taskId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: taskId,
          aggregateVersion: expectedVersion + 1,
          eventType: 'task.archived',
          safePayload: JSON.stringify({ taskId, actorId: principal.userId }),
        },
      })
      return { id: task.id, version: expectedVersion + 1 }
    })
  }

  private async idempotentResult(
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<{ id: string; number: string; version: number } | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    })
    if (!existing) return null
    if (existing.requestFingerprint !== requestFingerprint) {
      throw conflict('idempotency_key_reused')
    }
    if (!existing.resultId) return null
    return this.prisma.task.findUnique({
      where: { id: existing.resultId },
      select: { id: true, number: true, version: true },
    })
  }
}
