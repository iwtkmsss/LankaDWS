import { Injectable } from '@nestjs/common'
import type { CreateTaskInput, UpdateTaskInput } from '@lankadws/contracts'
import { badRequest, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import type { ValidatedTaskContext } from './task-types.js'

@Injectable()
export class TaskValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async validateCreate(
    principal: AuthPrincipal,
    input: CreateTaskInput,
  ): Promise<ValidatedTaskContext> {
    const companyId = this.scope.assertCompany(principal, undefined)
    const groupId = input.groupId ?? null
    const projectId = input.projectId ?? null
    const parentTaskId = input.parentTaskId ?? null
    const reporterId = input.reporterId ?? principal.userId
    const startsAt = input.startsAt ? new Date(input.startsAt) : null
    const dueAt = input.dueAt ? new Date(input.dueAt) : null

    this.assertDates(startsAt, dueAt)

    const userIds = [...new Set([
      reporterId,
      ...input.participants.map((participant) => participant.userId),
      ...input.reminders.flatMap((reminder) => (
        reminder.target.type === 'USER' ? [reminder.target.userId] : []
      )),
    ])]
    const reminderTargets = new Set([
      principal.userId,
      reporterId,
      ...input.participants.map((participant) => participant.userId),
    ])
    if (input.reminders.some((reminder) => (
      reminder.target.type === 'USER' && !reminderTargets.has(reminder.target.userId)
    ))) {
      throw badRequest('task_reminder_target')
    }
    const [group, project, parent, users, tags, relatedTasks] = await Promise.all([
      groupId
        ? this.prisma.group.findFirst({
            where: {
              id: groupId,
              workspaceId: principal.workspaceId,
              companyId,
              status: 'ACTIVE',
              members: { some: { userId: principal.userId, leftAt: null } },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      projectId
        ? this.prisma.project.findFirst({
            where: {
              id: projectId,
              workspaceId: principal.workspaceId,
              companyId,
              status: 'ACTIVE',
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      parentTaskId
        ? this.prisma.task.findFirst({
            where: {
              id: parentTaskId,
              workspaceId: principal.workspaceId,
              companyId,
              archivedAt: null,
            },
            select: {
              id: true,
              groupId: true,
              projectId: true,
            },
          })
        : Promise.resolve(null),
      this.prisma.user.findMany({
        where: {
          id: { in: userIds },
          workspaceId: principal.workspaceId,
          isActive: true,
        },
        select: { id: true },
      }),
      input.tagIds.length
        ? this.prisma.tag.findMany({
            where: {
              id: { in: [...new Set(input.tagIds)] },
              workspaceId: principal.workspaceId,
              companyId,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      input.relations.length
        ? this.prisma.task.findMany({
            where: {
              id: { in: [...new Set(input.relations.map((relation) => relation.targetTaskId))] },
              workspaceId: principal.workspaceId,
              companyId,
              groupId,
              projectId,
              archivedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])

    if (groupId && !group) throw notFound()
    if (projectId && !project) throw badRequest('task_project')
    if (parentTaskId && !parent) throw badRequest('task_parent')
    if (parent && (parent.groupId !== groupId || parent.projectId !== projectId)) {
      throw badRequest('task_parent_scope')
    }
    if (users.length !== userIds.length) throw badRequest('task_participant')
    if (tags.length !== new Set(input.tagIds).size) throw badRequest('task_tag')
    if (relatedTasks.length !== new Set(input.relations.map((relation) => relation.targetTaskId)).size) {
      throw badRequest('task_relation')
    }

    return {
      companyId,
      groupId,
      projectId,
      parentTaskId,
      reporterId,
      startsAt,
      dueAt,
      participants: input.participants,
      tagIds: [...new Set(input.tagIds)],
      relations: input.relations,
    }
  }

  validateUpdateDates(
    current: { startsAt: Date | null; dueAt: Date | null },
    input: UpdateTaskInput,
  ): { startsAt: Date | null; dueAt: Date | null } {
    const startsAt = input.startsAt === undefined
      ? current.startsAt
      : input.startsAt === null ? null : new Date(input.startsAt)
    const dueAt = input.dueAt === undefined
      ? current.dueAt
      : input.dueAt === null ? null : new Date(input.dueAt)
    this.assertDates(startsAt, dueAt)
    return { startsAt, dueAt }
  }

  async validateUpdateScope(
    principal: AuthPrincipal,
    task: {
      id: string
      companyId: string
      groupId: string | null
      projectId: string | null
      reporterId: string
    },
    input: UpdateTaskInput,
  ): Promise<{ groupId: string | null; projectId: string | null; reporterId: string }> {
    const groupId = input.groupId === undefined ? task.groupId : input.groupId
    const projectId = input.projectId === undefined ? task.projectId : input.projectId
    const reporterId = input.reporterId ?? task.reporterId
    const participants = await this.prisma.taskParticipant.findMany({
      where: {
        taskId: task.id,
        removedAt: null,
      },
      select: { userId: true },
    })
    const userIds = [...new Set([reporterId, ...participants.map((participant) => participant.userId)])]
    const [group, project, users] = await Promise.all([
      groupId
        ? this.prisma.group.findFirst({
            where: {
              id: groupId,
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              status: 'ACTIVE',
              members: { some: { userId: principal.userId, leftAt: null } },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      projectId
        ? this.prisma.project.findFirst({
            where: {
              id: projectId,
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              status: 'ACTIVE',
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.user.findMany({
        where: {
          id: { in: userIds },
          workspaceId: principal.workspaceId,
          isActive: true,
        },
        select: { id: true },
      }),
    ])
    if (groupId && !group) throw notFound()
    if (projectId && !project) throw badRequest('task_project')
    if (users.length !== userIds.length) throw badRequest('task_participant_scope')
    return { groupId, projectId, reporterId }
  }

  private assertDates(startsAt: Date | null, dueAt: Date | null): void {
    if (
      (startsAt && Number.isNaN(startsAt.getTime()))
      || (dueAt && Number.isNaN(dueAt.getTime()))
    ) {
      throw badRequest('task_date')
    }
    if (startsAt && dueAt && startsAt > dueAt) throw badRequest('task_date_order')
  }
}
