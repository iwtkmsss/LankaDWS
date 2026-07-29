import { Injectable } from '@nestjs/common'
import type { TaskParticipantInput, TaskParticipantRoleV2 } from '@bert-crm/contracts'
import { Permission } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FeedProjectionService } from '../feed/feed-projection.service.js'
import type { TaskTransaction } from './task-types.js'

@Injectable()
export class TaskParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly feedProjection: FeedProjectionService,
  ) {}

  async createMany(
    tx: TaskTransaction,
    taskId: string,
    actorId: string,
    participants: TaskParticipantInput[],
  ): Promise<void> {
    await tx.taskParticipant.createMany({
      data: participants.map((participant) => ({
        id: id('tpart'),
        taskId,
        userId: participant.userId,
        role: participant.role,
        addedById: actorId,
      })),
    })
  }

  async put(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
    role: TaskParticipantRoleV2,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertCanManage(principal, role)
    await this.assertEligibleUser(principal, task.companyId, task.groupId, userId)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('task_version')

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!updated.count) throw conflict('task_version')
      const existing = await tx.taskParticipant.findUnique({
        where: { taskId_userId: { taskId, userId } },
        select: { role: true, removedAt: true },
      })
      const participant = await tx.taskParticipant.upsert({
        where: { taskId_userId: { taskId, userId } },
        create: {
          id: id('tpart'),
          taskId,
          userId,
          role,
          addedById: principal.userId,
        },
        update: {
          role,
          addedById: principal.userId,
          removedAt: null,
        },
      })
      const [versionedTask, activeParticipants] = await Promise.all([
        tx.task.findUniqueOrThrow({ where: { id: taskId } }),
        tx.taskParticipant.findMany({
          where: { taskId, removedAt: null },
          select: { userId: true },
        }),
      ])
      const feedItemId = await this.feedProjection.projectTask(tx, versionedTask, {
        action: 'PARTICIPANT_CHANGED',
        actorId: principal.userId,
        recipientIds: activeParticipants.map((entry) => entry.userId),
      })
      await tx.notification.upsert({
        where: {
          dedupeKey: `task-participant:${taskId}:${userId}:${expectedVersion + 1}`,
        },
        create: {
          id: id('ntf'),
          recipientId: userId,
          category: 'TASKS',
          safeTitle: this.participantNotificationTitle(role),
          safeSnippet: task.title.slice(0, 180),
          entityType: 'TASK',
          entityId: taskId,
          requiresAction: false,
          deliveredAt: new Date(),
          dedupeKey: `task-participant:${taskId}:${userId}:${expectedVersion + 1}`,
        },
        update: {},
      })
      await this.recordChange(
        tx,
        principal,
        task.companyId,
        taskId,
        expectedVersion + 1,
        existing && !existing.removedAt ? 'task.participant_changed' : 'task.participant_added',
        {
          userId,
          role,
          previousRole: existing && !existing.removedAt ? existing.role : null,
          change: existing && !existing.removedAt ? 'ROLE_CHANGED' : 'ADDED',
          participantId: participant.id,
          feedItemId,
        },
      )
      return { version: expectedVersion + 1 }
    })
  }

  async remove(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    this.assertCanManage(principal)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('task_version')

    const participant = await this.prisma.taskParticipant.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { role: true, removedAt: true },
    })
    if (!participant || participant.removedAt) throw badRequest('task_participant')
    if (participant.role === 'RESPONSIBLE') {
      const responsibleCount = await this.prisma.taskParticipant.count({
        where: { taskId, role: 'RESPONSIBLE', removedAt: null },
      })
      if (responsibleCount <= 1) throw conflict('task_responsible_required')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!updated.count) throw conflict('task_version')
      await tx.taskParticipant.update({
        where: { taskId_userId: { taskId, userId } },
        data: { removedAt: new Date() },
      })
      const now = new Date()
      await tx.taskFollower.updateMany({
        where: { taskId, userId },
        data: { mutedAt: now },
      })
      const activeReminders = await tx.taskReminder.findMany({
        where: { taskId, userId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (activeReminders.length) {
        const reminderIds = activeReminders.map((reminder) => reminder.id)
        await tx.taskReminder.updateMany({
          where: { id: { in: reminderIds }, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        })
        await tx.backgroundJob.updateMany({
          where: {
            type: 'task.reminder',
            entityId: { in: reminderIds },
            state: 'QUEUED',
          },
          data: { state: 'CANCELLED' },
        })
      }
      const [versionedTask, activeParticipants] = await Promise.all([
        tx.task.findUniqueOrThrow({ where: { id: taskId } }),
        tx.taskParticipant.findMany({
          where: { taskId, removedAt: null },
          select: { userId: true },
        }),
      ])
      const feedItemId = await this.feedProjection.projectTask(tx, versionedTask, {
        action: 'PARTICIPANT_CHANGED',
        actorId: principal.userId,
        recipientIds: activeParticipants.map((entry) => entry.userId),
      })
      await this.recordChange(
        tx,
        principal,
        task.companyId,
        taskId,
        expectedVersion + 1,
        'task.participant_removed',
        {
          userId,
          role: participant.role,
          change: 'REMOVED',
          feedItemId,
        },
      )
      return { version: expectedVersion + 1 }
    })
  }

  private participantNotificationTitle(role: TaskParticipantRoleV2): string {
    if (role === 'RESPONSIBLE') return 'Вас додали як відповідального'
    if (role === 'COLLABORATOR') return 'Вас додали як співвиконавця'
    return 'Вас додали як спостерігача'
  }

  private async recordChange(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    companyId: string,
    taskId: string,
    version: number,
    auditAction: string,
    safeDiff: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId,
        actorType: 'USER',
        actorId: principal.userId,
        action: auditAction,
        entityType: 'TASK',
        entityId: taskId,
        result: 'SUCCESS',
        risk: 'NORMAL',
        correlationId: id('corr'),
        safeDiffJson: JSON.stringify(safeDiff),
      },
    })
    await tx.outboxEvent.create({
      data: {
        id: id('out'),
        aggregateType: 'TASK',
        aggregateId: taskId,
        aggregateVersion: version,
        eventType: 'task.participant_changed',
        safePayload: JSON.stringify({
          taskId,
          companyId,
          actorId: principal.userId,
          ...safeDiff,
        }),
      },
    })
  }

  private assertCanManage(principal: AuthPrincipal, role?: TaskParticipantRoleV2): void {
    const permission = role === 'RESPONSIBLE'
      ? Permission.TasksResponsiblesManage
      : Permission.TasksParticipantsManage
    if (
      !principal.permissions.has(permission)
      && !principal.permissions.has(Permission.TasksManage)
    ) {
      throw forbidden()
    }
  }

  private async assertEligibleUser(
    principal: AuthPrincipal,
    companyId: string,
    groupId: string | null,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        workspaceId: principal.workspaceId,
        status: 'ACTIVE',
        companyAccess: { some: { companyId, status: 'ACTIVE' } },
        ...(groupId
          ? { groupMemberships: { some: { groupId, leftAt: null } } }
          : {}),
      },
      select: { id: true },
    })
    if (!user) throw badRequest('task_participant')
  }
}
