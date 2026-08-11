
import { Injectable } from '@nestjs/common'
import type {
  DecideTaskApprovalInput,
  RequestTaskApprovalInput,
  TaskApprovalOption,
  TaskApprovalView,
} from '@bert-crm/contracts'
import type { Prisma, Task } from '../../generated/prisma/client.js'
import { id, sha256 } from '../../common/crypto.js'
import {
  badRequest,
  conflict,
  notFound,
  taskCompletionBlocked,
} from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FeedProjectionService } from '../feed/feed-projection.service.js'
import type { TaskTransaction } from './task-types.js'

const terminalStatuses = ['DONE', 'CANCELLED', 'ARCHIVED'] as const

type ApprovalResult = {
  approvalId: string
  status: 'PENDING' | 'APPROVED' | 'NEEDS_CHANGES'
  version: number
  watcherExitAvailable: boolean
}

@Injectable()
export class TaskApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly feedProjection: FeedProjectionService,
  ) {}

  async view(
    principal: AuthPrincipal,
    task: Task,
    canEdit: boolean,
  ): Promise<TaskApprovalView> {
    const rounds = await this.prisma.taskApprovalRound.findMany({
      where: { taskId: task.id },
      include: {
        approver: {
          select: { id: true, displayName: true, avatarAsset: true },
        },
        requestedBy: {
          select: { id: true, displayName: true, avatarAsset: true },
        },
      },
      orderBy: [{ roundNumber: 'desc' }],
    })
    const history = rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      approver: round.approver,
      requestedBy: round.requestedBy,
      requestedTaskVersion: round.requestedTaskVersion,
      requestedAt: round.requestedAt.toISOString(),
      decisionNote: round.decisionNote,
      decidedAt: round.decidedAt?.toISOString() ?? null,
      invalidatedAt: round.invalidatedAt?.toISOString() ?? null,
    }))
    const current = history.find((round) => round.status === 'PENDING') ?? null
    return {
      current,
      history,
      canRequest: canEdit
        && !current
        && task.status !== 'IN_REVIEW'
        && !terminalStatuses.includes(task.status as typeof terminalStatuses[number]),
      canDecide: current?.approver.id === principal.userId,
    }
  }

  async options(
    principal: AuthPrincipal,
    taskId: string,
  ): Promise<{ items: TaskApprovalOption[] }> {
    const task = await this.access.editableTask(principal, taskId)
    const requester = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { approverId: true },
    })
    const users = await this.prisma.user.findMany({
      where: {
        ...this.eligibleApproverWhere(task),
        id: { not: principal.userId },
      },
      select: {
        id: true,
        displayName: true,
        avatarAsset: true,
        jobTitle: true,
      },
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    return {
      items: users.map((user) => ({
        ...user,
        suggested: user.id === requester?.approverId,
      })),
    }
  }

  async request(
    principal: AuthPrincipal,
    taskId: string,
    input: RequestTaskApprovalInput,
    idempotencyKey: string,
  ): Promise<ApprovalResult> {
    const task = await this.access.editableTask(principal, taskId)
    const operation = `task.approval.request:${task.id}`
    const fingerprint = sha256(JSON.stringify({ operation, input }))
    const replay = await this.idempotentResult(
      principal.userId,
      idempotencyKey,
      operation,
      fingerprint,
      'PENDING',
    )
    if (replay) return replay
    if (input.approverId === principal.userId) throw badRequest('task_approval_self')
    if (
      task.status === 'IN_REVIEW'
      || terminalStatuses.includes(task.status as typeof terminalStatuses[number])
    ) {
      throw conflict('task_approval_state')
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const approver = await tx.user.findFirst({
          where: {
            ...this.eligibleApproverWhere(task),
            id: input.approverId,
          },
          select: { id: true },
        })
        if (!approver) throw badRequest('task_approver_not_eligible')
        const updated = await tx.task.updateMany({
          where: {
            id: task.id,
            version: input.expectedVersion,
            status: { notIn: [...terminalStatuses, 'IN_REVIEW'] },
            approvalRounds: { none: { status: 'PENDING' } },
          },
          data: {
            status: 'IN_REVIEW',
            completedAt: null,
            blockReason: null,
            version: { increment: 1 },
          },
        })
        if (!updated.count) throw conflict('task_version')
        const lastRound = await tx.taskApprovalRound.aggregate({
          where: { taskId: task.id },
          _max: { roundNumber: true },
        })
        const approvalId = id('tapr')
        const roundNumber = (lastRound._max.roundNumber ?? 0) + 1
        await tx.taskApprovalRound.create({
          data: {
            id: approvalId,
            taskId: task.id,
            roundNumber,
            approverId: input.approverId,
            requestedById: principal.userId,
            requestedTaskVersion: input.expectedVersion,
          },
        })
        await this.advanceParentForStatusChange(
          tx,
          principal,
          task,
          'SUBTASK_APPROVAL_REQUESTED',
        )
        const feedItemId = await this.projectStatusChange(
          tx,
          principal,
          task.id,
          'APPROVAL_REQUESTED',
        )
        await this.recordIdempotency(
          tx,
          principal.userId,
          idempotencyKey,
          operation,
          fingerprint,
          approvalId,
        )
        await this.recordEvent(
          tx,
          principal,
          task,
          'task.approval_requested',
          input.expectedVersion + 1,
          { approvalId, roundNumber, feedItemId },
        )
        return {
          approvalId,
          status: 'PENDING',
          version: input.expectedVersion + 1,
          watcherExitAvailable: false,
        }
      })
    } catch (error) {
      const concurrentReplay = await this.idempotentResult(
        principal.userId,
        idempotencyKey,
        operation,
        fingerprint,
        'PENDING',
      )
      if (concurrentReplay) return concurrentReplay
      throw error
    }
  }

  async decide(
    principal: AuthPrincipal,
    taskId: string,
    input: DecideTaskApprovalInput,
    idempotencyKey: string,
  ): Promise<ApprovalResult> {
    const task = await this.access.readableTask(principal, taskId)
    const operation = `task.approval.decision:${task.id}`
    const fingerprint = sha256(JSON.stringify({ operation, input }))
    const replay = await this.idempotentDecisionResult(
      principal.userId,
      idempotencyKey,
      operation,
      fingerprint,
    )
    if (replay) return replay
    const pending = await this.prisma.taskApprovalRound.findFirst({
      where: { taskId: task.id, status: 'PENDING' },
      select: { id: true, approverId: true },
    })
    if (!pending) throw conflict('task_approval_not_pending')
    if (pending.approverId !== principal.userId) throw notFound()

    try {
      return await this.prisma.$transaction(async (tx) => {
        const stillEligible = await tx.user.findFirst({
          where: {
            ...this.eligibleApproverWhere(task),
            id: principal.userId,
          },
          select: { id: true },
        })
        if (!stillEligible) throw notFound()
        if (input.decision === 'APPROVE') {
          const blockers = await tx.task.findMany({
            where: {
              parentTaskId: task.id,
              archivedAt: null,
              status: { notIn: ['DONE', 'CANCELLED', 'ARCHIVED'] },
            },
            select: { id: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
          if (blockers.length) {
            throw taskCompletionBlocked(blockers.map((blocker) => blocker.id))
          }
        }
        const nextStatus = input.decision === 'APPROVE' ? 'DONE' : 'IN_PROGRESS'
        const updatedTask = await tx.task.updateMany({
          where: {
            id: task.id,
            version: input.expectedVersion,
            status: 'IN_REVIEW',
          },
          data: {
            status: nextStatus,
            completedAt: nextStatus === 'DONE' ? new Date() : null,
            blockReason: null,
            version: { increment: 1 },
          },
        })
        if (!updatedTask.count) throw conflict('task_version')
        const resolvedStatus = input.decision === 'APPROVE'
          ? 'APPROVED' as const
          : 'NEEDS_CHANGES' as const
        const resolvedAt = new Date()
        const updatedRound = await tx.taskApprovalRound.updateMany({
          where: {
            id: pending.id,
            taskId: task.id,
            approverId: principal.userId,
            status: 'PENDING',
          },
          data: {
            status: resolvedStatus,
            decisionNote: input.note || null,
            decidedAt: resolvedAt,
            resolutionTaskVersion: input.expectedVersion + 1,
          },
        })
        if (!updatedRound.count) throw conflict('task_approval_not_pending')
        await this.advanceParentForStatusChange(
          tx,
          principal,
          task,
          input.decision === 'APPROVE'
            ? 'SUBTASK_APPROVAL_APPROVED'
            : 'SUBTASK_APPROVAL_NEEDS_CHANGES',
        )
        const feedItemId = await this.projectStatusChange(
          tx,
          principal,
          task.id,
          input.decision === 'APPROVE'
            ? 'APPROVAL_APPROVED'
            : 'APPROVAL_NEEDS_CHANGES',
        )
        await this.recordIdempotency(
          tx,
          principal.userId,
          idempotencyKey,
          operation,
          fingerprint,
          pending.id,
        )
        const action = input.decision === 'APPROVE'
          ? 'task.approval_approved'
          : 'task.approval_needs_changes'
        await this.recordEvent(
          tx,
          principal,
          task,
          action,
          input.expectedVersion + 1,
          {
            approvalId: pending.id,
            decision: input.decision,
            hasNote: Boolean(input.note),
            feedItemId,
          },
        )
        const watcherExitAvailable = input.decision === 'APPROVE' && Boolean(
          await tx.taskParticipant.findFirst({
            where: {
              taskId: task.id,
              userId: principal.userId,
              role: 'WATCHER',
              removedAt: null,
            },
            select: { id: true },
          }),
        )
        return {
          approvalId: pending.id,
          status: resolvedStatus,
          version: input.expectedVersion + 1,
          watcherExitAvailable,
        }
      })
    } catch (error) {
      const concurrentReplay = await this.idempotentDecisionResult(
        principal.userId,
        idempotencyKey,
        operation,
        fingerprint,
      )
      if (concurrentReplay) return concurrentReplay
      throw error
    }
  }

  async assertNoPending(taskId: string): Promise<void> {
    const pending = await this.prisma.taskApprovalRound.findFirst({
      where: { taskId, status: 'PENDING' },
      select: { id: true },
    })
    if (pending) throw conflict('task_approval_pending')
  }

  async invalidatePending(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'companyId'>,
    aggregateVersion: number,
    reasonCode: string,
  ): Promise<boolean> {
    const pending = await tx.taskApprovalRound.findFirst({
      where: { taskId: task.id, status: 'PENDING' },
      select: { id: true },
    })
    if (!pending) return false
    const invalidatedAt = new Date()
    const invalidated = await tx.taskApprovalRound.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: {
        status: 'INVALIDATED',
        invalidatedAt,
        invalidatedById: principal.userId,
        resolutionTaskVersion: aggregateVersion,
      },
    })
    if (!invalidated.count) return false
    await tx.task.updateMany({
      where: { id: task.id, status: 'IN_REVIEW' },
      data: {
        status: 'IN_PROGRESS',
        completedAt: null,
        blockReason: null,
      },
    })
    await this.recordEvent(
      tx,
      principal,
      task,
      'task.approval_invalidated',
      aggregateVersion,
      { approvalId: pending.id, reasonCode },
    )
    return true
  }

  private eligibleApproverWhere(task: Task): Prisma.UserWhereInput {
    return {
      workspaceId: task.workspaceId,
      isActive: true,
      AND: [
        {
          OR: [
            { accountType: 'ADMIN' },
            { primaryCompanyId: task.companyId },
          ],
        },
        ...(task.groupId
          ? [{ groupMemberships: { some: { groupId: task.groupId, leftAt: null } } }]
          : []),
        {
          OR: [
            { id: task.createdById },
            { id: task.reporterId },
            {
              taskParticipations: {
                some: { taskId: task.id, removedAt: null },
              },
            },
            { accountType: 'ADMIN' },
          ],
        },
      ],
    }
  }

  private async advanceParentForStatusChange(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    task: Pick<Task, 'parentTaskId' | 'companyId'>,
    reasonCode: string,
  ): Promise<void> {
    if (!task.parentTaskId) return
    const parent = await tx.task.update({
      where: { id: task.parentTaskId },
      data: { version: { increment: 1 } },
      select: { id: true, companyId: true, version: true },
    })
    await this.invalidatePending(
      tx,
      principal,
      parent,
      parent.version,
      reasonCode,
    )
  }

  private async projectStatusChange(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    taskId: string,
    action: string,
  ): Promise<string | null> {
    const [task, participants] = await Promise.all([
      tx.task.findUniqueOrThrow({ where: { id: taskId } }),
      tx.taskParticipant.findMany({
        where: { taskId, removedAt: null },
        select: { userId: true },
      }),
    ])
    return this.feedProjection.projectTask(tx, task, {
      action,
      actorId: principal.userId,
      recipientIds: participants.map((participant) => participant.userId),
    })
  }

  private async idempotentResult(
    userId: string,
    key: string,
    operation: string,
    fingerprint: string,
    expectedStatus: 'PENDING',
  ): Promise<ApprovalResult | null> {
    const existing = await this.idempotencyRecord(userId, key, operation, fingerprint)
    if (!existing) return null
    if (!existing.resultId) throw conflict('idempotency_result_missing')
    const round = await this.prisma.taskApprovalRound.findUnique({
      where: { id: existing.resultId },
      select: { id: true, requestedTaskVersion: true },
    })
    if (!round) throw conflict('idempotency_result_missing')
    return {
      approvalId: round.id,
      status: expectedStatus,
      version: round.requestedTaskVersion + 1,
      watcherExitAvailable: false,
    }
  }

  private async idempotentDecisionResult(
    userId: string,
    key: string,
    operation: string,
    fingerprint: string,
  ): Promise<ApprovalResult | null> {
    const existing = await this.idempotencyRecord(userId, key, operation, fingerprint)
    if (!existing) return null
    if (!existing.resultId) throw conflict('idempotency_result_missing')
    const round = await this.prisma.taskApprovalRound.findUnique({
      where: { id: existing.resultId },
      select: {
        id: true,
        taskId: true,
        approverId: true,
        status: true,
        resolutionTaskVersion: true,
      },
    })
    if (
      !round
      || !round.resolutionTaskVersion
      || !['APPROVED', 'NEEDS_CHANGES'].includes(round.status)
    ) {
      throw conflict('idempotency_result_missing')
    }
    const watcherExitAvailable = round.status === 'APPROVED' && Boolean(
      await this.prisma.taskParticipant.findFirst({
        where: {
          taskId: round.taskId,
          userId: round.approverId,
          role: 'WATCHER',
          removedAt: null,
        },
        select: { id: true },
      }),
    )
    return {
      approvalId: round.id,
      status: round.status as ApprovalResult['status'],
      version: round.resolutionTaskVersion,
      watcherExitAvailable,
    }
  }

  private async idempotencyRecord(
    userId: string,
    key: string,
    operation: string,
    fingerprint: string,
  ) {
    if (!key.trim() || key.length > 200) throw badRequest('idempotency_key_required')
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    })
    if (!existing) return null
    if (existing.requestFingerprint !== fingerprint) {
      throw conflict('idempotency_key_reused')
    }
    return existing
  }

  private async recordIdempotency(
    tx: TaskTransaction,
    userId: string,
    key: string,
    operation: string,
    fingerprint: string,
    resultId: string,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        id: id('idem'),
        userId,
        key,
        operation,
        requestFingerprint: fingerprint,
        resultType: 'TASK_APPROVAL',
        resultId,
        responseStatus: 200,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
  }

  private async recordEvent(
    tx: TaskTransaction,
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'companyId'>,
    action: string,
    version: number,
    safeDiff: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        actorType: 'USER',
        actorId: principal.userId,
        action,
        entityType: 'TASK',
        entityId: task.id,
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
        aggregateId: task.id,
        aggregateVersion: version,
        eventType: action,
        safePayload: JSON.stringify({
          taskId: task.id,
          companyId: task.companyId,
          actorId: principal.userId,
          ...safeDiff,
        }),
      },
    })
  }
}
