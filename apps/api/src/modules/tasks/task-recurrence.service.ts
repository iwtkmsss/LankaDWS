import { Injectable } from '@nestjs/common'
import { Temporal } from '@js-temporal/polyfill'
import type { TaskRecurrenceInput, TaskRelationType } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { TaskApprovalService } from './task-approval.service.js'
import type { TaskTransaction } from './task-types.js'

export interface RecurrenceRule {
  frequency: TaskRecurrenceInput['frequency']
  interval: number
  startsAt: Date
  daysOfWeek: number[]
  dayOfMonth: number | null
  endsAt: Date | null
  maxOccurrences: number | null
  timezone: string
}

function asZonedDateTime(value: Date, timezone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO(timezone)
}

export function nextRecurrenceOccurrence(
  rule: RecurrenceRule,
  current: Date,
): Date | null {
  const currentZoned = asZonedDateTime(current, rule.timezone)
  let next: Temporal.ZonedDateTime
  if (rule.frequency === 'DAILY') {
    next = currentZoned.add({ days: rule.interval })
  } else if (rule.frequency === 'WEEKLY') {
    const anchor = asZonedDateTime(rule.startsAt, rule.timezone)
    const anchorWeek = anchor.toPlainDate().subtract({ days: anchor.dayOfWeek - 1 })
    let candidate = currentZoned.add({ days: 1 })
    const weekdays = new Set(rule.daysOfWeek)
    for (;;) {
      const candidateWeek = candidate.toPlainDate().subtract({
        days: candidate.dayOfWeek - 1,
      })
      const weeksFromAnchor = anchorWeek.until(candidateWeek, {
        largestUnit: 'week',
      }).weeks
      if (
        weeksFromAnchor >= 0
        && weeksFromAnchor % rule.interval === 0
        && weekdays.has(candidate.dayOfWeek)
      ) {
        next = candidate
        break
      }
      candidate = candidate.add({ days: 1 })
    }
  } else if (rule.frequency === 'MONTHLY') {
    const day = rule.dayOfMonth ?? asZonedDateTime(rule.startsAt, rule.timezone).day
    const targetMonth = currentZoned.add({ months: rule.interval }).with({ day: 1 })
    next = targetMonth.with({
      day: Math.min(day, targetMonth.daysInMonth),
    })
  } else {
    next = currentZoned.add({ years: rule.interval })
  }
  const result = new Date(next.toInstant().epochMilliseconds)
  if (rule.endsAt && result > rule.endsAt) return null
  return result
}

export function recurrenceJobRunAt(
  occurrenceAt: Date,
  maximumReminderOffsetMinutes: number,
  now = new Date(),
): Date {
  const requested = new Date(
    occurrenceAt.getTime() - maximumReminderOffsetMinutes * 60_000,
  )
  return requested > now ? requested : now
}

export function recurrenceRelationForOccurrence(
  templateTaskId: string,
  occurrenceTaskId: string,
  relation: {
    sourceTaskId: string
    targetTaskId: string
    type: TaskRelationType
  },
): {
  sourceTaskId: string
  targetTaskId: string
  type: TaskRelationType
} {
  if (
    relation.sourceTaskId !== templateTaskId
    && relation.targetTaskId !== templateTaskId
  ) {
    throw new Error('RecurrenceRelationTemplateMismatch')
  }
  if (relation.type === 'BLOCKS') {
    return {
      sourceTaskId: relation.sourceTaskId === templateTaskId
        ? occurrenceTaskId
        : relation.sourceTaskId,
      targetTaskId: relation.targetTaskId === templateTaskId
        ? occurrenceTaskId
        : relation.targetTaskId,
      type: relation.type,
    }
  }
  const relatedTaskId = relation.sourceTaskId === templateTaskId
    ? relation.targetTaskId
    : relation.sourceTaskId
  const [sourceTaskId, targetTaskId] = [
    occurrenceTaskId,
    relatedTaskId,
  ].sort()
  return { sourceTaskId, targetTaskId, type: relation.type }
}

@Injectable()
export class TaskRecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly approvals: TaskApprovalService,
  ) {}

  async timezoneFor(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    if (!user) throw notFound()
    try {
      Temporal.Now.zonedDateTimeISO(user.timezone)
    } catch {
      throw badRequest('task_recurrence_timezone')
    }
    return user.timezone
  }

  create(
    tx: TaskTransaction,
    taskId: string,
    input: TaskRecurrenceInput,
    timezone: string,
    maximumReminderOffsetMinutes: number,
  ): Promise<string> {
    const startsAt = new Date(input.startsAt)
    const endsAt = input.endsAt ? new Date(input.endsAt) : null
    if (
      Number.isNaN(startsAt.getTime())
      || startsAt <= new Date()
      || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt < startsAt))
    ) {
      throw badRequest('task_recurrence_dates')
    }
    const recurrenceId = id('trec')
    return this.writeRecurrence(
      tx,
      recurrenceId,
      taskId,
      input,
      timezone,
      maximumReminderOffsetMinutes,
    )
  }

  async update(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskRecurrenceInput,
    expectedVersion: number,
  ) {
    const task = await this.access.editableTask(principal, taskId)
    if (task.parentTaskId) throw badRequest('task_recurrence_top_level')
    const recurrence = await this.prisma.taskRecurrence.findUnique({
      where: { templateTaskId: taskId },
    })
    const timezone = recurrence?.timezone ?? await this.timezoneFor(task.reporterId)
    const relativeReminder = await this.prisma.taskReminder.aggregate({
      where: {
        taskId,
        triggerType: { in: ['BEFORE_START', 'BEFORE_DUE'] },
        status: 'ACTIVE',
      },
      _max: { offsetMinutes: true },
    })
    const maximumReminderOffsetMinutes = relativeReminder._max.offsetMinutes ?? 0
    const startsAt = new Date(input.startsAt)
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw badRequest('task_recurrence_dates')
    }
    const nextRunAt = !recurrence
      || input.maxOccurrences === undefined
      || recurrence.generatedOccurrences < input.maxOccurrences
      ? startsAt
      : null

    return this.prisma.$transaction(async (tx) => {
      const taskUpdated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!taskUpdated.count) throw conflict('task_version')
      if (!recurrence) {
        const recurrenceId = id('trec')
        await this.writeRecurrence(
          tx,
          recurrenceId,
          taskId,
          input,
          timezone,
          maximumReminderOffsetMinutes,
        )
        await this.approvals.invalidatePending(
          tx,
          principal,
          task,
          expectedVersion + 1,
          'RECURRENCE_UPDATED',
        )
        return {
          id: recurrenceId,
          version: expectedVersion + 1,
          nextRunAt: startsAt.toISOString(),
        }
      }
      await tx.backgroundJob.updateMany({
        where: {
          type: 'task.recurrence',
          entityId: recurrence.id,
          state: 'QUEUED',
        },
        data: { state: 'CANCELLED' },
      })
      await tx.taskRecurrence.update({
        where: { id: recurrence.id },
        data: {
          frequency: input.frequency,
          interval: input.interval,
          daysOfWeekJson: input.daysOfWeek
            ? JSON.stringify(input.daysOfWeek)
            : null,
          dayOfMonth: input.dayOfMonth ?? null,
          startsAt,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          maxOccurrences: input.maxOccurrences ?? null,
          nextRunAt,
          timezone,
          isActive: Boolean(nextRunAt),
          version: { increment: 1 },
        },
      })
      if (nextRunAt) {
        await this.enqueue(
          tx,
          recurrence.id,
          nextRunAt,
          maximumReminderOffsetMinutes,
        )
      }
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'RECURRENCE_UPDATED',
      )
      return {
        id: recurrence.id,
        version: expectedVersion + 1,
        nextRunAt: nextRunAt?.toISOString() ?? null,
      }
    })
  }

  async cancel(
    principal: AuthPrincipal,
    taskId: string,
    expectedVersion: number,
  ) {
    const task = await this.access.editableTask(principal, taskId)
    const recurrence = await this.prisma.taskRecurrence.findUnique({
      where: { templateTaskId: taskId },
      select: { id: true },
    })
    if (!recurrence) throw notFound()
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!updated.count) throw conflict('task_version')
      await tx.taskRecurrence.update({
        where: { id: recurrence.id },
        data: { isActive: false, nextRunAt: null, version: { increment: 1 } },
      })
      await tx.backgroundJob.updateMany({
        where: {
          type: 'task.recurrence',
          entityId: recurrence.id,
          state: 'QUEUED',
        },
        data: { state: 'CANCELLED' },
      })
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        expectedVersion + 1,
        'RECURRENCE_CANCELLED',
      )
      return { id: recurrence.id, active: false, version: expectedVersion + 1 }
    })
  }

  private async writeRecurrence(
    tx: TaskTransaction,
    recurrenceId: string,
    taskId: string,
    input: TaskRecurrenceInput,
    timezone: string,
    maximumReminderOffsetMinutes: number,
  ): Promise<string> {
    const startsAt = new Date(input.startsAt)
    await tx.taskRecurrence.create({
      data: {
        id: recurrenceId,
        templateTaskId: taskId,
        frequency: input.frequency,
        interval: input.interval,
        daysOfWeekJson: input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null,
        dayOfMonth: input.dayOfMonth ?? null,
        startsAt,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        maxOccurrences: input.maxOccurrences ?? null,
        generatedOccurrences: 1,
        nextRunAt: startsAt,
        timezone,
      },
    })
    await this.enqueue(
      tx,
      recurrenceId,
      startsAt,
      maximumReminderOffsetMinutes,
    )
    return recurrenceId
  }

  private async enqueue(
    tx: TaskTransaction,
    recurrenceId: string,
    occurrenceAt: Date,
    maximumReminderOffsetMinutes: number,
  ): Promise<void> {
    await tx.backgroundJob.create({
      data: {
        id: id('job'),
        type: 'task.recurrence',
        entityType: 'TASK_RECURRENCE',
        entityId: recurrenceId,
        safePayload: JSON.stringify({
          occurrenceAt: occurrenceAt.toISOString(),
        }),
        idempotencyKey: `task-recurrence:${recurrenceId}:${occurrenceAt.toISOString()}`,
        runAt: recurrenceJobRunAt(
          occurrenceAt,
          maximumReminderOffsetMinutes,
        ),
      },
    })
  }

}
