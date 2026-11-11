import { notifyTaskParticipants } from './task-notifications.js'
import { Injectable } from '@nestjs/common'
import { Temporal } from '@js-temporal/polyfill'
import type { TaskRecurrenceInput, TaskRelationType } from '@lankadws/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskNumberAllocator } from '../../prisma/task-number-allocator.js'
import { recordAudit } from '../../common/audit.js'
import { writeTaskReminders } from './task-reminder.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
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
    private readonly taskNumbers: TaskNumberAllocator,
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
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.recurrence_changed')
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
    await this.access.editableTask(principal, taskId)
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
      await notifyTaskParticipants(tx, taskId, principal.userId, expectedVersion + 1, 'task.recurrence_changed')
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

  /**
   * Materialises one occurrence of a recurring task (background job handler).
   * Idempotent on (recurrenceId, occurrenceAt); stale or inactive jobs are no-ops.
   */
  async createOccurrence(
    recurrenceId: string,
    occurrenceAtIso: string,
  ): Promise<void> {
    const recurrence = await this.prisma.taskRecurrence.findUnique({
      where: { id: recurrenceId },
      include: {
        templateTask: {
          include: {
            participants: { where: { removedAt: null } },
            checklist: { orderBy: { position: 'asc' } },
            tags: true,
            reminders: {
              where: {
                status: 'ACTIVE',
                triggerType: { in: ['BEFORE_START', 'BEFORE_DUE'] },
              },
            },
            outgoingRelations: {
              where: { type: { in: ['RELATED', 'DUPLICATES'] } },
            },
            incomingRelations: {
              where: { type: { in: ['RELATED', 'DUPLICATES'] } },
            },
          },
        },
      },
    });
    if (
      !recurrence ||
      !recurrence.isActive ||
      !recurrence.nextRunAt ||
      recurrence.templateTask.archivedAt ||
      ['ARCHIVED'].includes(recurrence.templateTask.status)
    )
      return;
    const occurrenceAt = new Date(occurrenceAtIso);
    if (
      Number.isNaN(occurrenceAt.getTime()) ||
      occurrenceAt.getTime() !== recurrence.nextRunAt.getTime()
    )
      return;
    const source = recurrence.templateTask;
    const responsible = source.participants.find(
      (participant) => participant.role === 'RESPONSIBLE',
    );
    if (!responsible) throw new Error('TaskResponsibleMissing');
    const occurrenceParticipants = [
      responsible,
      ...source.participants.filter(
        (participant) =>
          participant.role !== 'RESPONSIBLE' &&
          participant.userId !== responsible.userId,
      ),
    ];
    const existing = await this.prisma.task.findUnique({
      where: {
        recurrenceId_recurrenceOccurrenceAt: {
          recurrenceId,
          recurrenceOccurrenceAt: occurrenceAt,
        },
      },
    });
    let daysOfWeek: number[] = [];
    if (recurrence.daysOfWeekJson) {
      const parsed = JSON.parse(recurrence.daysOfWeekJson) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
      ) {
        throw new Error('RecurrenceWeekdaysInvalid');
      }
      daysOfWeek = parsed as number[];
    }
    const rule: RecurrenceRule = {
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      startsAt: recurrence.startsAt,
      daysOfWeek,
      dayOfMonth: recurrence.dayOfMonth,
      endsAt: recurrence.endsAt,
      maxOccurrences: recurrence.maxOccurrences,
      timezone: recurrence.timezone,
    };
    const generatedOccurrences =
      recurrence.generatedOccurrences + (existing ? 0 : 1);
    const reachedMaximum =
      recurrence.maxOccurrences !== null &&
      generatedOccurrences >= recurrence.maxOccurrences;
    const nextOccurrenceAt = reachedMaximum
      ? null
      : nextRecurrenceOccurrence(rule, occurrenceAt);
    const maximumReminderOffset = source.reminders.reduce(
      (maximum, reminder) => Math.max(maximum, reminder.offsetMinutes ?? 0),
      0,
    );
    if (!existing) {
      const taskId = id('tsk');
      await this.taskNumbers.runInTransaction(
        this.prisma,
        async (tx, number) => {
          const duration =
            source.startsAt && source.dueAt
              ? source.dueAt.getTime() - source.startsAt.getTime()
              : null;
          const startsAt = source.startsAt ? occurrenceAt : null;
          const dueAt = source.dueAt
            ? new Date(occurrenceAt.getTime() + (duration ?? 0))
            : null;
          const task = await tx.task.create({
            data: {
              id: taskId,
              workspaceId: source.workspaceId,
              companyId: source.companyId,
              projectId: source.projectId,
              number,
              title: source.title,
              description: source.description,
              createdById: source.createdById,
              reporterId: source.reporterId,
              status: 'NEW',
              priority: source.priority,
              startsAt,
              dueAt,
              estimatedMinutes: source.estimatedMinutes,
              recurrenceId,
              recurrenceOccurrenceAt: occurrenceAt,
            },
          });
          if (occurrenceParticipants.length) {
            await tx.taskParticipant.createMany({
              data: occurrenceParticipants.map((participant) => ({
                id: id('tpart'),
                taskId,
                userId: participant.userId,
                role: participant.role,
                addedById: source.createdById,
              })),
            });
          }
          if (source.checklist.length) {
            await tx.taskChecklistItem.createMany({
              data: source.checklist.map((item, position) => ({
                id: id('tcheck'),
                taskId,
                title: item.title,
                isCompleted: false,
                position,
              })),
            });
          }
          if (source.tags.length) {
            await tx.taskTag.createMany({
              data: source.tags.map((tag) => ({
                taskId,
                tagId: tag.tagId,
              })),
            });
          }
          const relationRows = [
            ...source.outgoingRelations,
            ...source.incomingRelations,
          ].map((relation) => ({
            id: id('trel'),
            ...recurrenceRelationForOccurrence(source.id, taskId, relation),
            createdById: source.createdById,
          }));
          if (relationRows.length) {
            await tx.taskRelation.createMany({ data: relationRows });
          }
          await writeTaskReminders(
            tx,
            taskId,
            { startsAt, dueAt },
            occurrenceParticipants.map((participant) => participant.userId),
            source.reminders.flatMap((reminder) =>
              reminder.userId && reminder.offsetMinutes
                ? [
                    {
                      target: {
                        type: 'USER' as const,
                        userId: reminder.userId,
                      },
                      trigger: {
                        type: reminder.triggerType,
                        offsetMinutes: reminder.offsetMinutes,
                      } as {
                        type: 'BEFORE_START' | 'BEFORE_DUE';
                        offsetMinutes: number;
                      },
                    },
                  ]
                : [],
            ),
            new Date(),
            true,
          );
          await tx.taskRecurrence.update({
            where: { id: recurrenceId },
            data: {
              generatedOccurrences: { increment: 1 },
              nextRunAt: nextOccurrenceAt,
              isActive: Boolean(nextOccurrenceAt),
              version: { increment: 1 },
            },
          });
          if (nextOccurrenceAt) {
            await tx.backgroundJob.create({
              data: {
                id: id('job'),
                type: 'task.recurrence',
                entityType: 'TASK_RECURRENCE',
                entityId: recurrenceId,
                safePayload: JSON.stringify({
                  occurrenceAt: nextOccurrenceAt.toISOString(),
                }),
                idempotencyKey: `task-recurrence:${recurrenceId}:${nextOccurrenceAt.toISOString()}`,
                runAt: recurrenceJobRunAt(
                  nextOccurrenceAt,
                  maximumReminderOffset,
                ),
              },
            });
          }
          await recordAudit(tx, null, { workspaceId: source.workspaceId, companyId: source.companyId, actorType: 'SYSTEM', action: 'task.recurrence_created', entityType: 'TASK', entityId: taskId, safeDiff: {
                sourceTaskId: source.id,
                recurrenceId,
                occurrenceAt: occurrenceAt.toISOString(),
              } });
          await tx.outboxEvent.create({
            data: {
              id: id('out'),
              aggregateType: 'TASK',
              aggregateId: taskId,
              aggregateVersion: task.version,
              eventType: 'task.recurrence_created',
              safePayload: JSON.stringify({
                taskId,
                recurrenceId,
                occurrenceAt: occurrenceAt.toISOString(),
              }),
            },
          });
        },
      );
    }
  }
}
