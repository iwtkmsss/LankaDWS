import { Injectable } from '@nestjs/common'
import type {
  MentionCandidateView,
  MentionSearchQuery,
  TaskParticipantInput,
  TaskParticipantRoleV2,
} from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { normalizeUserSearchValue } from '../../common/user-search.js'
import type { Prisma, Task } from '../../generated/prisma/client.js'
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
    const responsibleCount = participants.filter((participant) => (
      participant.role === 'RESPONSIBLE'
    )).length
    if (responsibleCount !== 1) throw badRequest('task_responsible_required')
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

  async mentionCandidates(
    principal: AuthPrincipal,
    taskId: string,
    query: MentionSearchQuery,
  ): Promise<{ items: MentionCandidateView[] }> {
    const task = await this.access.readableTask(principal, taskId)
    const normalized = normalizeUserSearchValue(query.q)
    return {
      items: await this.prisma.user.findMany({
        where: {
          ...this.eligibleUserWhere(principal, task.groupId),
          ...(normalized
            ? {
                AND: [{
                  OR: [
                    { normalizedDisplayName: { contains: normalized } },
                    { normalizedUsername: { contains: normalized } },
                  ],
                }],
              }
            : {}),
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          jobTitle: true,
          avatarAsset: true,
        },
        orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
        take: query.limit,
      }),
    }
  }

  async ensureMentionWatchers(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'companyId' | 'groupId'>,
    userIds: string[],
  ): Promise<string[]> {
    const uniqueUserIds = [...new Set(userIds)]
    if (!uniqueUserIds.length) return []
    const eligible = await tx.user.findMany({
      where: this.eligibleUserWhere(principal, task.groupId, uniqueUserIds),
      select: { id: true },
    })
    if (eligible.length !== uniqueUserIds.length) throw badRequest('task_mention_outside_scope')

    const existing = await tx.taskParticipant.findMany({
      where: { taskId: task.id, userId: { in: uniqueUserIds } },
      select: { id: true, userId: true, removedAt: true },
    })
    const existingByUserId = new Map(existing.map((participant) => [participant.userId, participant]))
    const addedUserIds: string[] = []
    for (const userId of uniqueUserIds) {
      const participant = existingByUserId.get(userId)
      if (participant && !participant.removedAt) continue
      if (participant) {
        await tx.taskParticipant.update({
          where: { id: participant.id },
          data: {
            role: 'WATCHER',
            addedById: principal.userId,
            removedAt: null,
          },
        })
      } else {
        await tx.taskParticipant.create({
          data: {
            id: id('tpart'),
            taskId: task.id,
            userId,
            role: 'WATCHER',
            addedById: principal.userId,
          },
        })
      }
      addedUserIds.push(userId)
    }
    return addedUserIds
  }

  async recordMentionWatchersAdded(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'companyId'>,
    version: number,
    userIds: string[],
    feedItemId: string | null,
  ): Promise<void> {
    if (!userIds.length) return
    await this.recordChange(
      tx,
      principal,
      task.companyId,
      task.id,
      version,
      'task.participant_added',
      {
        userIds,
        role: 'WATCHER',
        change: 'MENTION_ADDED',
        feedItemId,
      },
    )
  }

  async put(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
    role: TaskParticipantRoleV2,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    if (task.status === 'IN_REVIEW') throw conflict('task_review_locked')
    await this.assertEligibleUser(principal, task.groupId, userId)
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
      if (
        existing?.role === 'RESPONSIBLE'
        && !existing.removedAt
        && role !== 'RESPONSIBLE'
      ) {
        throw conflict('task_responsible_required')
      }
      if (role === 'RESPONSIBLE') {
        await tx.taskParticipant.updateMany({
          where: {
            taskId,
            userId: { not: userId },
            role: 'RESPONSIBLE',
            removedAt: null,
          },
          data: { removedAt: new Date() },
        })
      }
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
  ): Promise<{ version: number; accessRetained: boolean }> {
    const task = await this.access.readableTask(principal, taskId)
    if (task.status === 'IN_REVIEW') throw conflict('task_review_locked')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('task_version')

    const participant = await this.prisma.taskParticipant.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { role: true, removedAt: true },
    })
    if (!participant || participant.removedAt) throw badRequest('task_participant')
    if (participant.role === 'RESPONSIBLE') throw conflict('task_responsible_required')
    const selfWatcherExit = userId === principal.userId && participant.role === 'WATCHER'
    if (!selfWatcherExit) {
      await this.access.editableTask(principal, taskId)
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!updated.count) throw conflict('task_version')
      if (selfWatcherExit) {
        const removed = await tx.taskParticipant.updateMany({
          where: {
            taskId,
            userId,
            role: 'WATCHER',
            removedAt: null,
          },
          data: { removedAt: new Date() },
        })
        if (!removed.count) throw conflict('task_participant')
      } else {
        await tx.taskParticipant.update({
          where: { taskId_userId: { taskId, userId } },
          data: { removedAt: new Date() },
        })
      }
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
      return {
        version: expectedVersion + 1,
        accessRetained: userId !== principal.userId
          || task.createdById === principal.userId
          || task.reporterId === principal.userId
          || isGlobalAdmin(principal),
      }
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

  private async assertEligibleUser(
    principal: AuthPrincipal,
    groupId: string | null,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: this.eligibleUserWhere(principal, groupId, [userId]),
      select: { id: true },
    })
    if (!user) throw badRequest('task_participant')
  }

  private eligibleUserWhere(
    principal: AuthPrincipal,
    groupId: string | null,
    userIds?: string[],
  ): Prisma.UserWhereInput {
    return {
      ...(userIds ? { id: { in: userIds } } : {}),
      workspaceId: principal.workspaceId,
      isActive: true,
      // A grouped task keeps active group membership as a mandatory boundary
      // for every role (docs/decisions.md 2026-07-24). An ungrouped task
      // admits any active workspace user regardless of primary company
      // (docs/decisions.md 2026-08-31), so company is deliberately not a
      // filter here.
      ...(groupId
        ? { groupMemberships: { some: { groupId, leftAt: null } } }
        : {}),
    }
  }
}
