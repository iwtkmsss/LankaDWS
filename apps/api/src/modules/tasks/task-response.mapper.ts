import { Injectable } from '@nestjs/common'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import type { TaskDetailRecord } from './task-types.js'

@Injectable()
export class TaskResponseMapper {
  detail(principal: AuthPrincipal, task: TaskDetailRecord) {
    const canReadTime = true
    const canManageReminders = true
    const activeTimer = task.timeEntries.find((entry) => entry.endedAt === null) ?? null
    const totalSeconds = task.timeEntries.reduce(
      (sum, entry) => sum + (entry.durationSeconds ?? 0),
      0,
    )
    const relations = [
      ...task.outgoingRelations.map((relation) => ({
        id: relation.id,
        type: relation.type,
        direction: 'OUTGOING' as const,
        task: relation.targetTask,
        createdAt: relation.createdAt.toISOString(),
      })),
      ...task.incomingRelations.map((relation) => ({
        id: relation.id,
        type: relation.type,
        direction: 'INCOMING' as const,
        task: relation.sourceTask,
        createdAt: relation.createdAt.toISOString(),
      })),
    ]

    return {
      id: task.id,
      number: task.number,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      version: task.version,
      groupId: task.groupId,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      startsAt: task.startsAt?.toISOString() ?? null,
      dueAt: task.dueAt?.toISOString() ?? null,
      estimatedMinutes: task.estimatedMinutes,
      completedAt: task.completedAt?.toISOString() ?? null,
      archivedAt: task.archivedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      createdBy: task.createdBy,
      reporter: task.reporter,
      group: task.group,
      project: task.project,
      parent: task.parent,
      subtasks: task.subtasks,
      participants: task.participants.map((participant) => ({
        id: participant.id,
        role: participant.role,
        user: participant.user,
        createdAt: participant.createdAt.toISOString(),
      })),
      checklist: task.checklist.map((item) => ({
        id: item.id,
        title: item.title,
        isCompleted: item.isCompleted,
        position: item.position,
        version: item.version,
        completedById: item.completedById,
        completedAt: item.completedAt?.toISOString() ?? null,
      })),
      tags: task.tags.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
      relations,
      reminders: task.reminders
        .filter((reminder) => canManageReminders || reminder.userId === principal.userId)
        .map((reminder) => ({
        id: reminder.id,
        userId: reminder.userId,
        triggerType: reminder.triggerType,
        remindAt: reminder.remindAt?.toISOString() ?? null,
        offsetMinutes: reminder.offsetMinutes,
        channel: reminder.channel,
        status: reminder.status,
        })),
      recurrence: task.recurrenceTemplate
        ? {
            id: task.recurrenceTemplate.id,
            frequency: task.recurrenceTemplate.frequency,
            interval: task.recurrenceTemplate.interval,
            daysOfWeek: this.parseWeekdays(task.recurrenceTemplate.daysOfWeekJson),
            dayOfMonth: task.recurrenceTemplate.dayOfMonth,
            startsAt: task.recurrenceTemplate.startsAt.toISOString(),
            endsAt: task.recurrenceTemplate.endsAt?.toISOString() ?? null,
            maxOccurrences: task.recurrenceTemplate.maxOccurrences,
            generatedOccurrences: task.recurrenceTemplate.generatedOccurrences,
            nextRunAt: task.recurrenceTemplate.nextRunAt?.toISOString() ?? null,
            timezone: task.recurrenceTemplate.timezone,
            isActive: task.recurrenceTemplate.isActive,
            version: task.recurrenceTemplate.version,
          }
        : null,
      time: canReadTime
        ? {
            totalSeconds,
            activeTimer: activeTimer
              ? {
                  id: activeTimer.id,
                  userId: activeTimer.userId,
                  startedAt: activeTimer.startedAt.toISOString(),
                }
              : null,
          }
        : null,
      permissions: {
        canEdit: this.canEdit(principal, task),
        canManageReporter: true,
        canManageResponsibles: true,
        canManageParticipants: true,
        canManageRelations: true,
        canManageRecurrence: true,
        canReadTime,
        canWriteTime: true,
        canArchive: task.createdById === principal.userId || task.reporterId === principal.userId || isGlobalAdmin(principal),
      },
    }
  }

  private canEdit(principal: AuthPrincipal, task: TaskDetailRecord): boolean {
    return task.createdById === principal.userId
      || task.reporterId === principal.userId
      || task.participants.some((participant) => (
        participant.user.id === principal.userId
        && ['RESPONSIBLE', 'COLLABORATOR'].includes(participant.role)
      ))
      || isGlobalAdmin(principal)
  }

  private parseWeekdays(value: string | null): number[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((day): day is number => Number.isInteger(day))
        : []
    } catch {
      return []
    }
  }
}
