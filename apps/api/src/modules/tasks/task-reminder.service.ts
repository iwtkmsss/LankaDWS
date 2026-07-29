import { Injectable } from '@nestjs/common'
import type { TaskReminderInput } from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import type { TaskTransaction } from './task-types.js'

interface ReminderTaskDates {
  startsAt: Date | null
  dueAt: Date | null
}

interface ReminderRow {
  id: string
  userId: string
  triggerType: 'AT' | 'BEFORE_START' | 'BEFORE_DUE'
  remindAt: Date
  offsetMinutes: number | null
}

export function resolveReminderAt(
  reminder: TaskReminderInput,
  task: ReminderTaskDates,
): Date {
  if (reminder.trigger.type === 'AT') return new Date(reminder.trigger.at)
  const anchor = reminder.trigger.type === 'BEFORE_START' ? task.startsAt : task.dueAt
  if (!anchor) throw badRequest('task_reminder_anchor')
  return new Date(anchor.getTime() - reminder.trigger.offsetMinutes * 60_000)
}

export async function writeTaskReminders(
  tx: TaskTransaction,
  taskId: string,
  task: ReminderTaskDates,
  participantIds: string[],
  reminders: TaskReminderInput[],
  now = new Date(),
  deliverPastImmediately = false,
): Promise<ReminderRow[]> {
  const rows: ReminderRow[] = []
  for (const reminder of reminders) {
    let remindAt = resolveReminderAt(reminder, task)
    if (Number.isNaN(remindAt.getTime())) {
      throw badRequest('task_reminder_time')
    }
    if (remindAt <= now) {
      if (!deliverPastImmediately) throw badRequest('task_reminder_time')
      remindAt = now
    }
    const latestAllowed = new Date(now)
    latestAllowed.setUTCFullYear(latestAllowed.getUTCFullYear() + 5)
    if (remindAt > latestAllowed) throw badRequest('task_reminder_time')
    const userIds = reminder.target.type === 'PARTICIPANTS'
      ? participantIds
      : [reminder.target.userId]
    for (const userId of [...new Set(userIds)]) {
      rows.push({
        id: id('trm'),
        userId,
        triggerType: reminder.trigger.type,
        remindAt,
        offsetMinutes: reminder.trigger.type === 'AT'
          ? null
          : reminder.trigger.offsetMinutes,
      })
    }
  }
  if (!rows.length) return rows
  await tx.taskReminder.createMany({
    data: rows.map((row) => ({
      id: row.id,
      taskId,
      userId: row.userId,
      triggerType: row.triggerType,
      remindAt: row.remindAt,
      offsetMinutes: row.offsetMinutes,
    })),
  })
  await tx.backgroundJob.createMany({
    data: rows.map((row) => ({
      id: id('job'),
      type: 'task.reminder',
      entityType: 'TASK_REMINDER',
      entityId: row.id,
      safePayload: JSON.stringify({ taskId, userId: row.userId }),
      idempotencyKey: `task-reminder:${row.id}`,
      runAt: row.remindAt,
    })),
  })
  return rows
}

@Injectable()
export class TaskReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
  ) {}

  createMany(
    tx: TaskTransaction,
    taskId: string,
    task: ReminderTaskDates,
    participantIds: string[],
    reminders: TaskReminderInput[],
  ) {
    return writeTaskReminders(tx, taskId, task, participantIds, reminders)
  }

  async add(
    principal: AuthPrincipal,
    taskId: string,
    reminder: TaskReminderInput,
    expectedVersion: number,
  ) {
    const task = await this.access.editableTask(principal, taskId)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('task_version')
    const participants = await this.prisma.taskParticipant.findMany({
      where: { taskId, removedAt: null },
      select: { userId: true },
    })
    const participantIds = participants.map((participant) => participant.userId)
    const allowedTargetIds = new Set([
      task.createdById,
      task.reporterId,
      ...participantIds,
    ])
    if (
      reminder.target.type === 'USER'
      && !allowedTargetIds.has(reminder.target.userId)
    ) {
      throw badRequest('task_reminder_target')
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!updated.count) throw conflict('task_version')
      const rows = await writeTaskReminders(
        tx,
        taskId,
        task,
        participantIds,
        [reminder],
      )
      return {
        reminders: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          remindAt: row.remindAt.toISOString(),
          triggerType: row.triggerType,
          offsetMinutes: row.offsetMinutes,
        })),
        version: expectedVersion + 1,
      }
    })
  }

  async cancel(
    principal: AuthPrincipal,
    taskId: string,
    reminderId: string,
  ): Promise<{ id: string; status: 'SENT' | 'CANCELLED' }> {
    await this.access.readableTask(principal, taskId)
    const reminder = await this.prisma.taskReminder.findFirst({
      where: { id: reminderId, taskId },
    })
    if (!reminder) throw notFound()
    if (
      reminder.userId !== principal.userId
      && !principal.permissions.has('tasks.manage')
    ) {
      throw forbidden()
    }
    if (reminder.status === 'ACTIVE') {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskReminder.updateMany({
          where: { id: reminderId, status: 'ACTIVE' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        })
        await tx.backgroundJob.updateMany({
          where: {
            type: 'task.reminder',
            entityId: reminderId,
            state: 'QUEUED',
          },
          data: { state: 'CANCELLED' },
        })
      })
    }
    return {
      id: reminder.id,
      status: reminder.status === 'SENT' ? 'SENT' : 'CANCELLED',
    }
  }
}
