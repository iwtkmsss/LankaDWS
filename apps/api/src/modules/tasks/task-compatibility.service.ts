import { Injectable } from '@nestjs/common'
import {
  type StructuredMentionInput,
  type StructuredMentionView,
  type PageResult,
  type TaskActivityPage,
  type TaskAttachmentView,
  type TaskDetailView,
  type TaskCommentInput,
  type TaskListItem,
  type TaskReference,
  type TaskSourceLinkView,
} from '@bert-crm/contracts'
import type { EntityLink, FileObject, Prisma, Task } from '../../generated/prisma/client.js'
import { id, sha256 } from '../../common/crypto.js'
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  taskCompletionBlocked,
} from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FeedProjectionService } from '../feed/feed-projection.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskApprovalService } from './task-approval.service.js'
import { TaskParticipantsService } from './task-participants.service.js'

const taskStatuses = [
  'NEW',
  'PLANNED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
] as const
const activeTaskStatuses = ['NEW', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] as const
const terminalTaskStatuses = ['DONE', 'CANCELLED', 'ARCHIVED'] as const
const taskPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const legacyViewRoles = ['RESPONSIBLE', 'CO_EXECUTOR', 'CREATOR', 'OBSERVER', 'ALL'] as const

type TaskStatusValue = typeof taskStatuses[number]
type TaskPriorityValue = typeof taskPriorities[number]
type LegacyViewRole = typeof legacyViewRoles[number]
type TaskRow = Prisma.TaskGetPayload<{
  include: {
    parent: {
      select: {
        id: true
        number: true
        title: true
        status: true
      }
    }
    subtasks: {
      select: {
        id: true
        status: true
      }
    }
    participants: {
      where: { removedAt: null }
      include: {
        user: {
          select: {
            id: true
            displayName: true
            avatarAsset: true
          }
        }
      }
    }
    reporter: {
      select: {
        id: true
        displayName: true
        avatarAsset: true
      }
    }
    group: {
      select: {
        id: true
        name: true
      }
    }
  }
}>

export interface CreateSubtaskInput {
  title: string
  description?: string
  assigneeId: string
  deadline?: string
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'URGENT'
  expectedVersion: number
}

export interface LegacyUpdateTaskInput {
  title: string
  description?: string
  assigneeId: string
  creatorId?: string
  deadline?: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'URGENT'
  blockReason?: string | null
  expectedVersion: number
}

export interface TaskUserStateInput {
  favorited?: boolean
  important?: boolean
}

export interface TaskFollowerInput {
  userId?: string
}

export interface DashboardTaskSummary {
  items: TaskListItem[]
  active: number
  overdue: number
  attention: number
  completedLast7Days: number
  byStatus: Array<{ status: TaskStatusValue; count: number }>
}

@Injectable()
export class TaskCompatibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly access: TaskAccessService,
    private readonly files: FilesService,
    private readonly commands: TaskCommandService,
    private readonly feedProjection: FeedProjectionService,
    private readonly participants: TaskParticipantsService,
    private readonly approvals: TaskApprovalService,
  ) {}

  async list(
    principal: AuthPrincipal,
    company: string | undefined,
    role: string = 'RESPONSIBLE',
    page = 1,
    pageSize = 25,
    filters: {
      search?: string
      status?: string
      priority?: string
      favorite?: string
      important?: string
      overdue?: string
      preset?: string
      dueFrom?: string
      dueTo?: string
      groupId?: string
      assigneeId?: string
      creatorId?: string
      coExecutorId?: string
      observerId?: string
    } = {},
  ): Promise<PageResult<TaskListItem>> {
    if (!Number.isInteger(page) || page < 1 || page > 100_000) throw badRequest('task_page')
    if (!legacyViewRoles.includes(role as LegacyViewRole)) throw badRequest('task_role')
    const viewRole = role as LegacyViewRole
    if (viewRole === 'ALL' && !isGlobalAdmin(principal)) throw forbidden()
    if (filters.status && !taskStatuses.includes(filters.status as TaskStatusValue)) {
      throw badRequest('task_status')
    }
    const normalizedPriority = this.normalizePriority(filters.priority)
    if (filters.priority && !normalizedPriority) throw badRequest('task_priority')
    if (filters.favorite && !['true', 'false'].includes(filters.favorite)) {
      throw badRequest('task_favorite')
    }
    if (filters.important && !['true', 'false'].includes(filters.important)) {
      throw badRequest('task_important')
    }
    if (filters.overdue && filters.overdue !== 'true') throw badRequest('task_overdue')
    if (filters.preset && !['ACTIVE', 'DEFERRED', 'OVERDUE', 'DUE_SOON'].includes(filters.preset)) {
      throw badRequest('task_preset')
    }
    if (
      (filters.dueFrom && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dueFrom))
      || (filters.dueTo && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dueTo))
      || (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo)
    ) {
      throw badRequest('task_due_range')
    }

    const companyIds = this.scope.allowedCompanies(principal, company)
    const now = new Date()
    const dueFrom = filters.dueFrom ? new Date(`${filters.dueFrom}T00:00:00.000Z`) : null
    const dueTo = filters.dueTo ? new Date(`${filters.dueTo}T23:59:59.999Z`) : null
    const preset = filters.preset ?? (filters.overdue === 'true' ? 'OVERDUE' : undefined)
    const presetWhere: Prisma.TaskWhereInput | null = preset === 'ACTIVE'
      ? { status: { in: [...activeTaskStatuses] } }
      : preset === 'DEFERRED'
        ? { status: 'PLANNED' }
        : preset === 'OVERDUE'
          ? { dueAt: { lt: now }, status: { notIn: [...terminalTaskStatuses] } }
          : preset === 'DUE_SOON'
            ? {
                dueAt: { gte: now, lte: new Date(now.getTime() + 72 * 60 * 60 * 1_000) },
                status: { notIn: [...terminalTaskStatuses] },
              }
            : null
    const roleWhere = this.roleWhere(principal.userId, viewRole)
    const membershipWhere: Prisma.TaskWhereInput = {
      OR: [
        { groupId: null },
        {
          group: {
            members: {
              some: {
                userId: principal.userId,
                leftAt: null,
              },
            },
          },
        },
      ],
    }
    const search = filters.search?.trim().slice(0, 100)
    const where: Prisma.TaskWhereInput = {
      workspaceId: principal.workspaceId,
      companyId: { in: companyIds },
      archivedAt: null,
      AND: [
        roleWhere,
        membershipWhere,
        ...(presetWhere ? [presetWhere] : []),
        ...(dueFrom || dueTo
          ? [{ dueAt: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } }]
          : []),
        ...(filters.assigneeId
          ? [{
              participants: {
                some: {
                  userId: filters.assigneeId,
                  role: 'RESPONSIBLE' as const,
                  removedAt: null,
                },
              },
            }]
          : []),
        ...(filters.coExecutorId
          ? [{
              participants: {
                some: {
                  userId: filters.coExecutorId,
                  role: 'COLLABORATOR' as const,
                  removedAt: null,
                },
              },
            }]
          : []),
        ...(filters.observerId
          ? [{
              participants: {
                some: {
                  userId: filters.observerId,
                  role: 'WATCHER' as const,
                  removedAt: null,
                },
              },
            }]
          : []),
      ],
      ...(search ? {
        OR: [
          { title: { contains: search } },
          { number: { contains: search } },
          { legacyNumbers: { some: { legacyNumber: { contains: search } } } },
        ],
      } : {}),
      ...(filters.status ? { status: filters.status as TaskStatusValue } : {}),
      ...(normalizedPriority ? { priority: normalizedPriority } : {}),
      ...(filters.groupId ? { groupId: filters.groupId } : {}),
      ...(filters.creatorId ? { reporterId: filters.creatorId } : {}),
      ...(filters.favorite
        ? {
            userStates: filters.favorite === 'true'
              ? { some: { userId: principal.userId, favoritedAt: { not: null } } }
              : { none: { userId: principal.userId, favoritedAt: { not: null } } },
          }
        : {}),
      ...(filters.important
        ? {
            userStates: filters.important === 'true'
              ? { some: { userId: principal.userId, important: true } }
              : { none: { userId: principal.userId, important: true } },
          }
        : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: this.listInclude(),
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.task.count({ where }),
    ])
    return {
      items: await this.mapRows(rows, principal.userId),
      page,
      pageSize,
      total,
    }
  }

  async dashboardSummary(
    principal: AuthPrincipal,
    company: string | undefined,
    completedSince: Date,
  ): Promise<DashboardTaskSummary> {
    const companyIds = this.scope.allowedCompanies(principal, company)
    const responsibleWhere = this.roleWhere(principal.userId, 'RESPONSIBLE')
    const baseWhere: Prisma.TaskWhereInput = {
      workspaceId: principal.workspaceId,
      companyId: { in: companyIds },
      archivedAt: null,
      AND: [
        responsibleWhere,
        {
          OR: [
            { groupId: null },
            {
              group: {
                members: {
                  some: {
                    userId: principal.userId,
                    leftAt: null,
                  },
                },
              },
            },
          ],
        },
      ],
    }
    const nonTerminalWhere: Prisma.TaskWhereInput = {
      ...baseWhere,
      status: { notIn: [...terminalTaskStatuses] },
    }
    const activeWhere: Prisma.TaskWhereInput = {
      ...baseWhere,
      status: { in: [...activeTaskStatuses] },
    }
    const overdueWhere: Prisma.TaskWhereInput = {
      ...nonTerminalWhere,
      dueAt: { lt: new Date() },
    }
    const attentionWhere: Prisma.TaskWhereInput = {
      ...nonTerminalWhere,
      OR: [{ status: 'BLOCKED' }, { dueAt: { lt: new Date() } }],
    }
    const [rows, active, overdue, attention, completedLast7Days, grouped] =
      await this.prisma.$transaction([
        this.prisma.task.findMany({
          where: nonTerminalWhere,
          include: this.listInclude(),
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: 5,
        }),
        this.prisma.task.count({ where: activeWhere }),
        this.prisma.task.count({ where: overdueWhere }),
        this.prisma.task.count({ where: attentionWhere }),
        this.prisma.task.count({
          where: {
            ...baseWhere,
            status: 'DONE',
            completedAt: { gte: completedSince },
          },
        }),
        this.prisma.task.groupBy({
          by: ['status'],
          where: activeWhere,
          _count: { id: true },
        }),
      ])
    return {
      items: await this.mapRows(rows, principal.userId),
      active,
      overdue,
      attention,
      completedLast7Days,
      byStatus: grouped.map((entry) => ({
        status: entry.status,
        count: entry._count.id,
      })),
    }
  }

  async detail(principal: AuthPrincipal, taskId: string): Promise<TaskDetailView> {
    await this.access.readableTask(principal, taskId)
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        ...this.listInclude(),
        checklist: { orderBy: { position: 'asc' } },
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })
    const canEdit = await this.canEdit(principal, task)
    const [comments, entityLinks, personalState, following, followerCount, reminders, approval] = await Promise.all([
      this.prisma.comment.findMany({
        where: { entityType: 'TASK', entityId: task.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.entityLink.findMany({
        where: {
          OR: [
            { sourceType: 'TASK', sourceId: task.id },
            { targetType: 'TASK', targetId: task.id },
          ],
        },
      }),
      this.prisma.taskUserState.findUnique({
        where: { taskId_userId: { taskId: task.id, userId: principal.userId } },
        select: { favoritedAt: true, important: true },
      }),
      this.prisma.taskFollower.findUnique({
        where: { taskId_userId: { taskId: task.id, userId: principal.userId } },
        select: { mutedAt: true },
      }),
      this.prisma.taskFollower.count({ where: { taskId: task.id, mutedAt: null } }),
      this.prisma.taskReminder.findMany({
        where: {
          taskId: task.id,
          userId: principal.userId,
          status: 'ACTIVE',
          remindAt: { not: null },
        },
        select: {
          id: true,
          remindAt: true,
          status: true,
        },
        orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      }),
      this.approvals.view(principal, task, canEdit),
    ])
    const [fileLinks, contentMentions] = await Promise.all([
      this.prisma.fileLink.findMany({
        where: {
          OR: [
            {
              entityType: 'TASK',
              entityId: task.id,
              purpose: 'ATTACHMENT',
            },
            {
              entityType: 'TASK_COMMENT',
              entityId: { in: comments.map((comment) => comment.id) },
              purpose: 'ATTACHMENT',
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.contentMention.findMany({
        where: {
          workspaceId: principal.workspaceId,
          sourceType: 'TASK_COMMENT',
          sourceId: { in: comments.map((comment) => comment.id) },
        },
        orderBy: [{ sourceId: 'asc' }, { start: 'asc' }],
      }),
    ])
    const [attachedFiles, commentAuthors] = await Promise.all([
      this.prisma.fileObject.findMany({
        where: {
          id: { in: [...new Set(fileLinks.map((link) => link.fileId))] },
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
        },
      }),
      this.prisma.user.findMany({
        where: {
          id: {
            in: [...new Set([
              ...comments.map((comment) => comment.authorId),
              ...contentMentions.map((mention) => mention.userId),
            ])],
          },
        },
        select: {
          id: true,
          displayName: true,
          avatarAsset: true,
          primaryCompanyId: true,
          accountType: true,
          isActive: true,
          groupMemberships: {
            where: { groupId: task.groupId ?? '__no_group__', leftAt: null },
            select: { id: true },
          },
        },
      }),
    ])
    const filesById = new Map(attachedFiles.map((file) => [file.id, file]))
    const authorsById = new Map(commentAuthors.map((author) => [author.id, author]))
    const attachmentView = (file: FileObject): TaskAttachmentView => ({
      id: file.id,
      fileName: file.safeFilename,
      bytes: file.bytes,
      mimeType: file.detectedMime ?? file.declaredMime,
      scanStatus: file.scanStatus,
      createdAt: file.createdAt.toISOString(),
      canRemove: file.ownerId === principal.userId || canEdit,
    })
    const taskAttachments = fileLinks
      .filter((link) => link.entityType === 'TASK')
      .flatMap((link) => {
        const file = filesById.get(link.fileId)
        return file ? [attachmentView(file)] : []
      })
    const sourceLinks = await this.taskSourceLinks(principal, task, entityLinks)
    const subtasks = task.subtasks.map((subtask) => this.taskReference(subtask))
    const primaryResponsible = task.participants.find((participant) => (
      participant.role === 'RESPONSIBLE' && participant.userId === task.reporterId
    ))?.user ?? task.participants.find((participant) => (
      participant.role === 'RESPONSIBLE'
    ))?.user ?? task.reporter
    const responsibles = task.participants
      .filter((participant) => participant.role === 'RESPONSIBLE')
      .map((participant) => participant.user)
    const legacyParticipants = task.participants
      .filter((participant) => participant.role !== 'RESPONSIBLE')
      .map((participant) => ({
        id: participant.id,
        user: participant.user,
        role: participant.role === 'COLLABORATOR' ? 'CO_EXECUTOR' as const : 'OBSERVER' as const,
        addedAt: participant.createdAt.toISOString(),
      }))
    return {
      id: task.id,
      number: task.number,
      companyId: task.companyId,
      parentTaskId: task.parentTaskId,
      title: task.title,
      description: task.description,
      blockReason: task.blockReason,
      creator: task.reporter,
      assignee: primaryResponsible,
      responsibles,
      reporter: task.reporter,
      group: task.group,
      status: task.status,
      priority: this.legacyPriority(task.priority),
      deadline: task.dueAt?.toISOString() ?? null,
      version: task.version,
      commentCount: comments.length,
      attachmentCount: taskAttachments.length,
      subtaskProgress: {
        done: subtasks.filter((subtask) => this.isTerminal(subtask.status)).length,
        total: subtasks.length,
      },
      viewerRoles: this.viewerRoles(principal.userId, task),
      checklist: task.checklist.map((item) => ({
        id: item.id,
        text: item.title,
        isDone: item.isCompleted,
        version: item.version,
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        author: authorsById.get(comment.authorId) ?? {
          id: comment.authorId,
          displayName: 'Недоступний користувач',
          avatarAsset: null,
        },
        body: comment.body,
        mentions: contentMentions
          .filter((mention) => mention.sourceId === comment.id)
          .map<StructuredMentionView>((mention) => {
            const mentionedUser = authorsById.get(mention.userId)
            return {
              userId: mention.userId,
              start: mention.start,
              end: mention.end,
              active: Boolean(
                mentionedUser?.isActive
                && (
                  mentionedUser.accountType === 'ADMIN'
                  || (
                    mentionedUser.primaryCompanyId === task.companyId
                    && (!task.groupId || mentionedUser.groupMemberships.length > 0)
                  )
                ),
              ),
            }
          }),
        createdAt: comment.createdAt.toISOString(),
        replyToCommentId: comment.replyToCommentId,
        replyPreview: (() => {
          if (!comment.replyToCommentId) return null
          const parent = comments.find((candidate) => candidate.id === comment.replyToCommentId)
          if (!parent) return null
          return {
            authorName: authorsById.get(parent.authorId)?.displayName ?? 'Недоступний користувач',
            body: parent.body.slice(0, 180),
          }
        })(),
        attachments: fileLinks
          .filter((link) => (
            link.entityType === 'TASK_COMMENT'
            && link.entityId === comment.id
          ))
          .flatMap((link) => {
            const file = filesById.get(link.fileId)
            return file ? [attachmentView(file)] : []
          }),
      })),
      attachments: taskAttachments,
      sourceLinks,
      parent: task.parent ? this.taskReference(task.parent) : null,
      subtasks,
      coExecutors: legacyParticipants.filter((participant) => participant.role === 'CO_EXECUTOR'),
      observers: legacyParticipants.filter((participant) => participant.role === 'OBSERVER'),
      canEdit,
      canReassign: this.canManageResponsibles(principal, task, canEdit),
      canTransferCreator: this.canManageReporter(principal, task, canEdit),
      canCreateSubtask: !task.parentTaskId
        && !this.isTerminal(task.status)
        && canEdit,
      canManageParticipants: this.canManageParticipants(principal, task, canEdit),
      canAttachFiles: true,
      approval,
      personalState: {
        favorited: Boolean(personalState?.favoritedAt),
        important: personalState?.important ?? false,
        following: Boolean(following && !following.mutedAt),
        followerCount,
        reminders: reminders.flatMap((reminder) => (
          reminder.remindAt
            ? [{
                id: reminder.id,
                remindAt: reminder.remindAt.toISOString(),
                status: reminder.status,
              }]
            : []
        )),
      },
    }
  }

  async updateLegacy(
    principal: AuthPrincipal,
    taskId: string,
    input: LegacyUpdateTaskInput,
  ): Promise<{ version: number }> {
    const task = await this.access.editableTask(principal, taskId)
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest('task_version')
    }
    if (task.version !== input.expectedVersion) throw conflict('task_version')
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    const blockReason = typeof input.blockReason === 'string' ? input.blockReason.trim() : ''
    if (!title || title.length > 200) throw badRequest('task_title')
    if (description.length > 20_000) throw badRequest('task_description')
    if (blockReason.length > 1_000) throw badRequest('task_block_reason')
    const priority = this.normalizePriority(input.priority)
    if (!priority) throw badRequest('task_priority')
    const dueAt = input.deadline ? new Date(input.deadline) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) throw badRequest('task_due_at')
    const reporterId = input.creatorId ?? task.reporterId
    const userIds = [...new Set([input.assigneeId, reporterId])]
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        isActive: true,
        OR: [
          { accountType: 'ADMIN' },
          {
            primaryCompanyId: task.companyId,
            ...(task.groupId ? { groupMemberships: { some: { groupId: task.groupId, leftAt: null } } } : {}),
          },
        ],
      },
      select: { id: true },
    })
    if (users.length !== userIds.length) throw badRequest('task_participant')
    if (reporterId !== task.reporterId && !this.canManageReporter(principal, task, true)) {
      throw forbidden()
    }
    const currentResponsible = await this.prisma.taskParticipant.findUnique({
      where: { taskId_userId: { taskId, userId: input.assigneeId } },
      select: { role: true, removedAt: true },
    })
    if (
      (currentResponsible?.role !== 'RESPONSIBLE' || currentResponsible.removedAt)
      && !this.canManageResponsibles(principal, task, true)
    ) {
      throw forbidden()
    }
    const changedFields = [
      ...(title !== task.title ? ['title'] : []),
      ...(description !== task.description ? ['description'] : []),
      ...(currentResponsible?.role !== 'RESPONSIBLE' || currentResponsible.removedAt
        ? ['assignee']
        : []),
      ...(reporterId !== task.reporterId ? ['creator'] : []),
      ...(dueAt?.getTime() !== task.dueAt?.getTime() ? ['deadline'] : []),
      ...(priority !== task.priority ? ['priority'] : []),
      ...(blockReason !== (task.blockReason ?? '') ? ['blockReason'] : []),
    ]
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, version: input.expectedVersion },
        data: {
          title,
          description,
          reporterId,
          dueAt,
          priority,
          blockReason: blockReason || null,
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict('task_version')
      await tx.taskParticipant.upsert({
        where: { taskId_userId: { taskId: task.id, userId: input.assigneeId } },
        create: {
          id: id('tpart'),
          taskId: task.id,
          userId: input.assigneeId,
          role: 'RESPONSIBLE',
          addedById: principal.userId,
        },
        update: {
          role: 'RESPONSIBLE',
          removedAt: null,
          addedById: principal.userId,
        },
      })
      await tx.taskParticipant.updateMany({
        where: {
          taskId: task.id,
          userId: { not: input.assigneeId },
          role: 'RESPONSIBLE',
          removedAt: null,
        },
        data: { removedAt: new Date() },
      })
      if (changedFields.length) {
        await this.approvals.invalidatePending(
          tx,
          principal,
          task,
          input.expectedVersion + 1,
          'TASK_UPDATED',
        )
      }
      await this.recordEvent(tx, principal, task, 'task.updated', input.expectedVersion + 1, {
        legacyCompatibility: true,
        changedFields,
      })
    })
    return { version: input.expectedVersion + 1 }
  }

  async createSubtask(
    principal: AuthPrincipal,
    taskId: string,
    input: CreateSubtaskInput,
    idempotencyKey: string,
  ) {
    const parent = await this.access.editableTask(principal, taskId)
    if (parent.parentTaskId || this.isTerminal(parent.status)) throw badRequest('task_parent')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest('task_version')
    }
    const priority = this.normalizePriority(input.priority ?? 'MEDIUM')
    if (!priority) throw badRequest('task_priority')
    const dueAt = input.deadline ? new Date(input.deadline) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) throw badRequest('task_due_at')
    const result = await this.commands.create(principal, {
      title: input.title,
      description: input.description ?? '',
      groupId: parent.groupId,
      projectId: parent.projectId,
      parentTaskId: parent.id,
      reporterId: principal.userId,
      priority,
      dueAt: dueAt?.toISOString() ?? null,
      participants: [{ userId: input.assigneeId, role: 'RESPONSIBLE' }],
      checklistItems: [],
      tagIds: [],
      relations: [],
      reminders: [],
      recurrence: null,
      attachmentIds: [],
    }, idempotencyKey, { expectedParentVersion: input.expectedVersion })
    const currentParent = await this.prisma.task.findUniqueOrThrow({
      where: { id: parent.id },
      select: { version: true },
    })
    return {
      ...result,
      parentTaskId: parent.id,
      parentVersion: currentParent.version,
    }
  }

  async uploadAttachment(
    principal: AuthPrincipal,
    taskId: string,
    file: UploadedBinary,
  ): Promise<TaskAttachmentView> {
    const task = await this.access.readableTask(principal, taskId)
    const attachmentCount = await this.prisma.fileLink.count({
      where: {
        entityType: 'TASK',
        entityId: task.id,
        purpose: 'ATTACHMENT',
      },
    })
    if (attachmentCount >= 20) throw badRequest('task_attachment_limit')
    const uploaded = await this.files.upload(principal, task.companyId, file)
    const createdAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.fileLink.create({
        data: {
          id: id('fln'),
          fileId: uploaded.id,
          entityType: 'TASK',
          entityId: task.id,
          purpose: 'ATTACHMENT',
          aclMode: 'ENTITY',
        },
      })
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        updated.version,
        'ATTACHMENT_ADDED',
      )
      await this.recordEvent(tx, principal, task, 'task.attachment_added', updated.version, {
        attachmentCount: 1,
      })
    })
    return {
      id: uploaded.id,
      fileName: uploaded.fileName,
      bytes: uploaded.bytes,
      mimeType: uploaded.mimeType,
      scanStatus: uploaded.scanStatus,
      createdAt: createdAt.toISOString(),
      canRemove: true,
    }
  }

  async removeAttachment(
    principal: AuthPrincipal,
    taskId: string,
    fileId: string,
  ): Promise<{ id: string; removed: true }> {
    const task = await this.access.readableTask(principal, taskId)
    const link = await this.prisma.fileLink.findUnique({
      where: {
        fileId_entityType_entityId_purpose: {
          fileId,
          entityType: 'TASK',
          entityId: task.id,
          purpose: 'ATTACHMENT',
        },
      },
    })
    if (!link) throw notFound()
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
      },
      select: { ownerId: true },
    })
    if (!file) throw notFound()
    if (file.ownerId !== principal.userId && !await this.canEdit(principal, task)) throw notFound()
    const commentIds = await this.prisma.comment.findMany({
      where: { entityType: 'TASK', entityId: task.id },
      select: { id: true },
    })
    await this.prisma.$transaction(async (tx) => {
      await tx.fileLink.delete({ where: { id: link.id } })
      await tx.fileLink.deleteMany({
        where: {
          fileId,
          entityType: 'TASK_COMMENT',
          entityId: { in: commentIds.map((comment) => comment.id) },
          purpose: 'ATTACHMENT',
        },
      })
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      await this.approvals.invalidatePending(
        tx,
        principal,
        task,
        updated.version,
        'ATTACHMENT_REMOVED',
      )
      await this.recordEvent(tx, principal, task, 'task.attachment_removed', updated.version, {
        attachmentCount: -1,
      })
    })
    return { id: fileId, removed: true }
  }

  async activity(
    principal: AuthPrincipal,
    taskId: string,
    cursor?: string,
  ): Promise<TaskActivityPage> {
    const task = await this.access.readableTask(principal, taskId)
    const cursorEvent = cursor
      ? await this.prisma.auditEvent.findFirst({
          where: { id: cursor, entityType: 'TASK', entityId: task.id },
          select: { id: true, createdAt: true },
        })
      : null
    if (cursor && !cursorEvent) throw badRequest('task_activity_cursor')
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        workspaceId: principal.workspaceId,
        entityType: 'TASK',
        entityId: task.id,
        result: 'SUCCESS',
        ...(cursorEvent
          ? {
              OR: [
                { createdAt: { lt: cursorEvent.createdAt } },
                { createdAt: cursorEvent.createdAt, id: { lt: cursorEvent.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    })
    const page = rows.slice(0, 20)
    const actors = await this.prisma.user.findMany({
      where: {
        id: {
          in: [...new Set(page.flatMap((event) => event.actorId ? [event.actorId] : []))],
        },
      },
      select: { id: true, displayName: true, avatarAsset: true },
    })
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]))
    return {
      items: page.map((event) => ({
        id: event.id,
        action: event.action,
        label: this.activityLabel(event.action, event.safeDiffJson),
        actor: event.actorId ? actorsById.get(event.actorId) ?? null : null,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 20 ? page.at(-1)?.id ?? null : null,
    }
  }

  async setUserState(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskUserStateInput,
    idempotencyKey: string,
  ): Promise<{ favorited: boolean; important: boolean }> {
    const task = await this.access.readableTask(principal, taskId)
    if (
      (input.favorited === undefined && input.important === undefined)
      || (input.favorited !== undefined && typeof input.favorited !== 'boolean')
      || (input.important !== undefined && typeof input.important !== 'boolean')
    ) {
      throw badRequest('task_user_state')
    }
    const current = await this.prisma.taskUserState.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: principal.userId } },
    })
    const favorited = input.favorited ?? Boolean(current?.favoritedAt)
    const important = input.important ?? current?.important ?? false
    const operation = `task.user-state:${task.id}`
    const requestFingerprint = sha256(JSON.stringify({ operation, favorited, important }))
    if (await this.idempotencyHit(principal.userId, idempotencyKey, operation, requestFingerprint)) {
      return { favorited, important }
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const state = await tx.taskUserState.upsert({
        where: { taskId_userId: { taskId: task.id, userId: principal.userId } },
        create: {
          id: id('tstate'),
          taskId: task.id,
          userId: principal.userId,
          favoritedAt: favorited ? now : null,
          important,
        },
        update: {
          favoritedAt: favorited ? current?.favoritedAt ?? now : null,
          important,
        },
      })
      await this.recordIdempotency(
        tx,
        principal.userId,
        idempotencyKey,
        operation,
        requestFingerprint,
        'TASK_USER_STATE',
        state.id,
      )
    })
    return { favorited, important }
  }

  async followTask(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskFollowerInput,
    idempotencyKey: string,
  ): Promise<{ userId: string; following: true }> {
    const task = await this.access.readableTask(principal, taskId)
    const userId = input.userId ?? principal.userId
    await this.assertFollowerTarget(principal, task, userId)
    const operation = `task.follower.add:${task.id}`
    const requestFingerprint = sha256(JSON.stringify({ operation, userId }))
    if (await this.idempotencyHit(principal.userId, idempotencyKey, operation, requestFingerprint)) {
      return { userId, following: true }
    }
    await this.prisma.$transaction(async (tx) => {
      const follower = await tx.taskFollower.upsert({
        where: { taskId_userId: { taskId: task.id, userId } },
        create: { id: id('tfol'), taskId: task.id, userId },
        update: { mutedAt: null },
      })
      await this.recordIdempotency(
        tx,
        principal.userId,
        idempotencyKey,
        operation,
        requestFingerprint,
        'TASK_FOLLOWER',
        follower.id,
      )
    })
    return { userId, following: true }
  }

  async unfollowTask(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
  ): Promise<{ userId: string; following: false }> {
    const task = await this.access.readableTask(principal, taskId)
    await this.assertFollowerTarget(principal, task, userId)
    const now = new Date()
    await this.prisma.taskFollower.upsert({
      where: { taskId_userId: { taskId: task.id, userId } },
      create: { id: id('tfol'), taskId: task.id, userId, mutedAt: now },
      update: { mutedAt: now },
    })
    return { userId, following: false }
  }

  async changeStatus(
    principal: AuthPrincipal,
    taskId: string,
    status: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    if (!taskStatuses.includes(status as TaskStatusValue)) throw badRequest('task_status')
    if (status === 'IN_REVIEW') throw badRequest('task_approval_required')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('task_version')
    const task = await this.access.editableTask(principal, taskId)
    if (task.version !== expectedVersion) throw conflict('task_version')
    await this.approvals.assertNoPending(task.id)
    const nextStatus = status as TaskStatusValue
    if (nextStatus === 'DONE') {
      const blockers = await this.activeSubtaskIds(task.id)
      if (blockers.length) throw taskCompletionBlocked(blockers)
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, version: expectedVersion },
        data: {
          status: nextStatus,
          version: { increment: 1 },
          completedAt: nextStatus === 'DONE' ? new Date() : null,
          ...(nextStatus !== 'BLOCKED' ? { blockReason: null } : {}),
          ...(nextStatus === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
        },
      })
      if (!result.count) throw conflict('task_version')
      const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
      if (task.parentTaskId && nextStatus !== task.status) {
        const parent = await tx.task.update({
          where: { id: task.parentTaskId },
          data: { version: { increment: 1 } },
          select: { id: true, companyId: true, version: true },
        })
        await this.approvals.invalidatePending(
          tx,
          principal,
          parent,
          parent.version,
          'SUBTASK_STATUS_CHANGED',
        )
      }
      const participantIds = await tx.taskParticipant.findMany({
        where: { taskId: task.id, removedAt: null },
        select: { userId: true },
      })
      const sourceAction = nextStatus === 'BLOCKED'
        ? 'BLOCKED'
        : task.status === 'BLOCKED' ? 'UNBLOCKED' : 'STATUS_CHANGED'
      await this.feedProjection.projectTask(tx, updated, {
        action: sourceAction,
        actorId: principal.userId,
        recipientIds: participantIds.map((participant) => participant.userId),
      })
      await this.recordEvent(tx, principal, task, 'task.status_changed', updated.version, {
        status: { from: task.status, to: nextStatus },
      })
    })
    return { version: expectedVersion + 1 }
  }

  async addComment(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskCommentInput,
    idempotencyKey?: string,
  ) {
    const task = await this.access.readableTask(principal, taskId)
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!body || body.length > 4_000) throw badRequest('comment_body')
    const mentions = input.mentions.toSorted((left, right) => left.start - right.start || left.end - right.end)
    const mentionedUserIds = this.validateStructuredMentions(body, mentions)
    const replyToCommentId = typeof input.replyToCommentId === 'string'
      ? input.replyToCommentId.trim()
      : null
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? [...new Set(input.attachmentIds.map((fileId) => fileId.trim()).filter(Boolean))]
      : []
    if (attachmentIds.length > 5) throw badRequest('task_comment_attachments')
    const operation = `task.comment.create:${task.id}`
    const requestFingerprint = sha256(JSON.stringify({
      operation,
      body,
      replyToCommentId,
      attachmentIds,
      mentions,
    }))
    const existingCommentId = idempotencyKey
      ? await this.idempotentResultId(
          principal.userId,
          idempotencyKey,
          operation,
          requestFingerprint,
        )
      : null
    if (existingCommentId) {
      return this.prisma.comment.findUniqueOrThrow({ where: { id: existingCommentId } })
    }
    const [replyTarget, links] = await Promise.all([
      replyToCommentId
        ? this.prisma.comment.findFirst({
            where: {
              id: replyToCommentId,
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              entityType: 'TASK',
              entityId: task.id,
              deletedAt: null,
              replyToCommentId: null,
            },
            select: { id: true, authorId: true },
          })
        : null,
      attachmentIds.length
        ? this.prisma.fileLink.findMany({
            where: {
              fileId: { in: attachmentIds },
              entityType: 'TASK',
              entityId: task.id,
              purpose: 'ATTACHMENT',
              aclMode: 'ENTITY',
            },
            select: { fileId: true },
          })
        : [],
    ])
    if (replyToCommentId && !replyTarget) throw badRequest('task_comment_reply')
    if (links.length !== attachmentIds.length) throw badRequest('task_comment_attachments')
    const commentId = id('cmt')
    const createComment = () => this.prisma.$transaction(async (tx) => {
      const addedWatcherIds = await this.participants.ensureMentionWatchers(
        tx,
        principal,
        task,
        mentionedUserIds,
      )
      const comment = await tx.comment.create({
        data: {
          id: commentId,
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          entityType: 'TASK',
          entityId: task.id,
          authorId: principal.userId,
          body,
          visibility: 'PARTICIPANTS',
          replyToCommentId,
        },
      })
      if (mentions.length) {
        await tx.contentMention.createMany({
          data: mentions.map((mention) => ({
            id: id('cmn'),
            workspaceId: principal.workspaceId,
            sourceType: 'TASK_COMMENT',
            sourceId: comment.id,
            userId: mention.userId,
            start: mention.start,
            end: mention.end,
            label: mention.label,
          })),
        })
      }
      if (attachmentIds.length) {
        await tx.fileLink.createMany({
          data: attachmentIds.map((fileId) => ({
            id: id('fln'),
            fileId,
            entityType: 'TASK_COMMENT',
            entityId: comment.id,
            purpose: 'ATTACHMENT',
            aclMode: 'ENTITY',
          })),
        })
      }
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      const [activeParticipants, followers] = await Promise.all([
        tx.taskParticipant.findMany({
          where: { taskId: task.id, removedAt: null },
          select: { userId: true },
        }),
        tx.taskFollower.findMany({
          where: { taskId: task.id, mutedAt: null, userId: { not: principal.userId } },
          select: { userId: true },
        }),
      ])
      const recipients = [...new Set([
        task.reporterId,
        ...activeParticipants.map((participant) => participant.userId),
        ...followers.map((follower) => follower.userId),
        ...(replyTarget?.authorId ? [replyTarget.authorId] : []),
      ])].filter((userId) => userId !== principal.userId)
      const mentionedRecipients = new Set(mentionedUserIds)
      for (const recipientId of recipients) {
        const isMention = mentionedRecipients.has(recipientId)
        await tx.notification.upsert({
          where: { dedupeKey: `task-comment:${comment.id}:${recipientId}` },
          create: {
            id: id('ntf'),
            recipientId,
            category: isMention ? 'MENTION' : 'TASKS',
            safeTitle: isMention ? 'Вас згадали в коментарі до завдання' : 'Новий коментар до завдання',
            safeSnippet: task.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            deliveredAt: new Date(),
            dedupeKey: `task-comment:${comment.id}:${recipientId}`,
          },
          update: {},
        })
      }
      let feedItemId: string | null = null
      if (addedWatcherIds.length) {
        const versionedTask = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
        feedItemId = await this.feedProjection.projectTask(tx, versionedTask, {
          action: 'PARTICIPANT_CHANGED',
          actorId: principal.userId,
          recipientIds: activeParticipants.map((participant) => participant.userId),
        })
        await this.participants.recordMentionWatchersAdded(
          tx,
          principal,
          task,
          updated.version,
          addedWatcherIds,
          feedItemId,
        )
      }
      if (idempotencyKey) {
        await this.recordIdempotency(
          tx,
          principal.userId,
          idempotencyKey,
          operation,
          requestFingerprint,
          'TASK_COMMENT',
          comment.id,
        )
      }
      await this.recordEvent(tx, principal, task, 'task.comment_created', updated.version, {
        commentId,
        reply: Boolean(replyToCommentId),
        attachmentCount: attachmentIds.length,
        mentionCount: mentionedUserIds.length,
        watcherAddedCount: addedWatcherIds.length,
        feedItemId,
      })
      return comment
    })
    try {
      return await createComment()
    } catch (error) {
      if (idempotencyKey && (error as { code?: string }).code === 'P2002') {
        const concurrentCommentId = await this.idempotentResultId(
          principal.userId,
          idempotencyKey,
          operation,
          requestFingerprint,
        )
        if (concurrentCommentId) {
          return this.prisma.comment.findUniqueOrThrow({ where: { id: concurrentCommentId } })
        }
      }
      throw error
    }
  }

  private listInclude() {
    return {
      parent: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
        },
      },
      subtasks: {
        where: { archivedAt: null },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
        },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
      participants: {
        where: { removedAt: null },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              avatarAsset: true,
            },
          },
        },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
      reporter: {
        select: {
          id: true,
          displayName: true,
          avatarAsset: true,
        },
      },
      group: {
        select: {
          id: true,
          name: true,
        },
      },
    } satisfies Prisma.TaskInclude
  }

  private roleWhere(userId: string, role: LegacyViewRole): Prisma.TaskWhereInput {
    if (role === 'ALL') return {}
    if (role === 'CREATOR') return { reporterId: userId }
    const participantRole = role === 'RESPONSIBLE'
      ? 'RESPONSIBLE'
      : role === 'CO_EXECUTOR'
        ? 'COLLABORATOR'
        : 'WATCHER'
    return {
      participants: {
        some: {
          userId,
          role: participantRole,
          removedAt: null,
        },
      },
    }
  }

  private async mapRows(rows: TaskRow[], userId: string): Promise<TaskListItem[]> {
    return Promise.all(rows.map(async (row) => {
      const [commentCount, attachmentCount] = await Promise.all([
        this.prisma.comment.count({
          where: { entityType: 'TASK', entityId: row.id, deletedAt: null },
        }),
        this.prisma.fileLink.count({
          where: {
            entityType: 'TASK',
            entityId: row.id,
            purpose: 'ATTACHMENT',
          },
        }),
      ])
      const responsible = row.participants.find((participant) => (
        participant.role === 'RESPONSIBLE'
      ))?.user ?? row.reporter
      const responsibles = row.participants
        .filter((participant) => participant.role === 'RESPONSIBLE')
        .map((participant) => participant.user)
      return {
        id: row.id,
        number: row.number,
        companyId: row.companyId,
        parentTaskId: row.parentTaskId,
        title: row.title,
        assignee: responsible,
        responsibles,
        reporter: row.reporter,
        group: row.group,
        status: row.status,
        priority: this.legacyPriority(row.priority),
        deadline: row.dueAt?.toISOString() ?? null,
        version: row.version,
        commentCount,
        attachmentCount,
        subtaskProgress: {
          done: row.subtasks.filter((subtask) => this.isTerminal(subtask.status)).length,
          total: row.subtasks.length,
        },
        viewerRoles: this.viewerRoles(userId, row),
      }
    }))
  }

  private viewerRoles(
    userId: string,
    task: Pick<Task, 'createdById' | 'reporterId'> & {
      participants: Array<{ userId: string; role: 'RESPONSIBLE' | 'COLLABORATOR' | 'WATCHER' }>
    },
  ): TaskListItem['viewerRoles'] {
    const roles: TaskListItem['viewerRoles'] = []
    if (task.participants.some((participant) => (
      participant.userId === userId && participant.role === 'RESPONSIBLE'
    ))) {
      roles.push('RESPONSIBLE')
    }
    if (task.participants.some((participant) => (
      participant.userId === userId && participant.role === 'COLLABORATOR'
    ))) {
      roles.push('CO_EXECUTOR')
    }
    if (task.reporterId === userId || task.createdById === userId) roles.push('CREATOR')
    if (task.participants.some((participant) => (
      participant.userId === userId && participant.role === 'WATCHER'
    ))) {
      roles.push('OBSERVER')
    }
    return roles
  }

  private normalizePriority(value?: string): TaskPriorityValue | null {
    if (!value) return null
    const normalized = value === 'CRITICAL' ? 'URGENT' : value
    return taskPriorities.includes(normalized as TaskPriorityValue)
      ? normalized as TaskPriorityValue
      : null
  }

  private legacyPriority(value: TaskPriorityValue): TaskListItem['priority'] {
    return value === 'URGENT' ? 'CRITICAL' : value
  }

  private taskReference(task: {
    id: string
    number: string
    title: string
    status: TaskStatusValue
  }): TaskReference {
    return {
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
    }
  }

  private isTerminal(status: string): boolean {
    return terminalTaskStatuses.includes(status as typeof terminalTaskStatuses[number])
  }

  private async canEdit(principal: AuthPrincipal, task: Task): Promise<boolean> {
    if (
      task.createdById === principal.userId
      || task.reporterId === principal.userId
      || isGlobalAdmin(principal)
    ) {
      return true
    }
    return Boolean(await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId: principal.userId,
        role: { in: ['RESPONSIBLE', 'COLLABORATOR'] },
        removedAt: null,
      },
      select: { id: true },
    }))
  }

  private canManageReporter(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && (
      task.createdById === principal.userId
      || isGlobalAdmin(principal)
    )
  }

  private canManageResponsibles(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && (
      task.createdById === principal.userId
      || task.reporterId === principal.userId
      || isGlobalAdmin(principal)
    )
  }

  private canManageParticipants(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && (
      task.createdById === principal.userId
      || task.reporterId === principal.userId
      || isGlobalAdmin(principal)
    )
  }

  private async assertFollowerTarget(
    principal: AuthPrincipal,
    task: Task,
    userId: string,
  ): Promise<void> {
    if (!userId || userId.length > 120) throw badRequest('task_follower')
    if (userId !== principal.userId && !isGlobalAdmin(principal)) {
      throw forbidden()
    }
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [
          { accountType: 'ADMIN' },
          {
            primaryCompanyId: task.companyId,
            ...(task.groupId ? { groupMemberships: { some: { groupId: task.groupId, leftAt: null } } } : {}),
          },
        ],
      },
      select: { id: true },
    })
    if (!user) throw badRequest('task_follower')
    if (
      userId === task.createdById
      || userId === task.reporterId
      || await this.prisma.taskParticipant.findFirst({
        where: { taskId: task.id, userId, removedAt: null },
        select: { id: true },
      })
      || isGlobalAdmin(principal)
    ) {
      return
    }
    throw badRequest('task_follower')
  }

  private async activeSubtaskIds(taskId: string): Promise<string[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        parentTaskId: taskId,
        archivedAt: null,
        status: { notIn: [...terminalTaskStatuses] },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => row.id)
  }

  private async taskSourceLinks(
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'companyId'>,
    links: EntityLink[],
  ): Promise<TaskSourceLinkView[]> {
    const references = links.map((link) => (
      link.sourceType === 'TASK' && link.sourceId === task.id
        ? { link, type: link.targetType, id: link.targetId }
        : { link, type: link.sourceType, id: link.sourceId }
    ))
    const messageIds = references
      .filter((reference) => reference.type === 'MESSAGE')
      .map((reference) => reference.id)
    const lifecycleIds = references
      .filter((reference) => reference.type === 'LIFECYCLE')
      .map((reference) => reference.id)
    const documentIds = references
      .filter((reference) => reference.type === 'DOCUMENT')
      .map((reference) => reference.id)
    const [messages, lifecycle, documents] = await Promise.all([
      messageIds.length
        ? this.prisma.message.findMany({
            where: {
              id: { in: messageIds },
              thread: {
                workspaceId: principal.workspaceId,
                OR: [{ companyId: null }, { companyId: task.companyId }],
                participants: {
                  some: { userId: principal.userId, leftAt: null },
                },
              },
            },
            select: {
              id: true,
              thread: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          })
        : [],
      lifecycleIds.length
        ? this.prisma.lifecycleProcess.findMany({
            where: {
              id: { in: lifecycleIds },
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
            },
            select: { id: true, processType: true },
          })
        : [],
      documentIds.length
        ? this.prisma.document.findMany({
            where: {
              id: { in: documentIds },
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              OR: [
                { ownerId: principal.userId },
                { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
              ],
            },
            select: { id: true, number: true, name: true },
          })
        : [],
    ])
    const messagesById = new Map(messages.map((message) => [message.id, message]))
    const lifecycleById = new Map(lifecycle.map((process) => [process.id, process]))
    const documentsById = new Map(documents.map((document) => [document.id, document]))
    return references.flatMap<TaskSourceLinkView>(({ link, type, id: referenceId }) => {
      if (type === 'MESSAGE') {
        const message = messagesById.get(referenceId)
        return message
          ? [{
              id: link.id,
              kind: 'MESSAGE',
              label: message.thread.title
                ? `Повідомлення · ${message.thread.title}`
                : 'Повідомлення з чату',
              href: `/messages/${encodeURIComponent(message.thread.id)}?company=${encodeURIComponent(task.companyId)}&message=${encodeURIComponent(message.id)}`,
              createdAt: link.createdAt.toISOString(),
            }]
          : []
      }
      if (type === 'LIFECYCLE') {
        const process = lifecycleById.get(referenceId)
        if (!process) return []
        const offboarding = process.processType === 'OFFBOARDING'
        return [{
          id: link.id,
          kind: 'LIFECYCLE',
          label: offboarding ? 'Процес звільнення' : 'Процес адаптації',
          href: `/${offboarding ? 'offboarding' : 'onboarding'}/${encodeURIComponent(process.id)}?company=${encodeURIComponent(task.companyId)}`,
          createdAt: link.createdAt.toISOString(),
        }]
      }
      if (type === 'DOCUMENT') {
        const document = documentsById.get(referenceId)
        return document
          ? [{
              id: link.id,
              kind: 'DOCUMENT',
              label: `${document.number} · ${document.name}`,
              href: `/documents/${encodeURIComponent(document.id)}?company=${encodeURIComponent(task.companyId)}`,
              createdAt: link.createdAt.toISOString(),
            }]
          : []
      }
      return []
    })
  }

  private validateStructuredMentions(body: string, mentions: StructuredMentionInput[]): string[] {
    let previousEnd = 0
    for (const mention of mentions) {
      if (
        mention.start < previousEnd
        || mention.end > body.length
        || body.slice(mention.start, mention.end) !== `@${mention.label}`
      ) {
        throw badRequest('task_mention_invalid')
      }
      previousEnd = mention.end
    }
    return [...new Set(mentions.map((mention) => mention.userId))]
  }

  private async idempotentResultId(
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<string | null> {
    if (!key || key.length > 200) throw badRequest('idempotency_key_required')
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    })
    if (!existing) return null
    if (existing.requestFingerprint !== requestFingerprint) {
      throw conflict('idempotency_key_reused')
    }
    return existing.resultId
  }

  private async idempotencyHit(
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<boolean> {
    if (!key || key.length > 200) throw badRequest('idempotency_key_required')
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    })
    if (!existing) return false
    if (existing.requestFingerprint !== requestFingerprint) {
      throw conflict('idempotency_key_reused')
    }
    return true
  }

  private async recordIdempotency(
    tx: Prisma.TransactionClient,
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
    resultType: string,
    resultId: string,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        id: id('idem'),
        userId,
        key,
        operation,
        requestFingerprint,
        resultType,
        resultId,
        responseStatus: 200,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    task: Task,
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
        }),
      },
    })
  }

  private activityLabel(action: string, safeDiffJson: string): string {
    let diff: Record<string, unknown> = {}
    try {
      diff = JSON.parse(safeDiffJson) as Record<string, unknown>
    } catch {
      diff = {}
    }
    if (action === 'task.created') return 'Створено завдання'
    if (action === 'task.updated') {
      const fieldLabels: Record<string, string> = {
        title: 'назву',
        description: 'опис',
        assignee: 'відповідального',
        creator: 'постановника',
        deadline: 'строк',
        priority: 'пріоритет',
        blockReason: 'причину блокування',
      }
      const fields = Array.isArray(diff.changedFields)
        ? diff.changedFields
          .filter((field): field is string => typeof field === 'string')
          .map((field) => fieldLabels[field] ?? field)
        : []
      return fields.length ? `Оновлено ${fields.join(', ')}` : 'Оновлено завдання'
    }
    const labels: Record<string, string> = {
      'task.status_changed': 'Статус змінено',
      'task.comment_created': 'Додано коментар',
      'task.attachment_added': 'Додано вкладення',
      'task.attachment_removed': 'Вкладення вилучено',
      'task.participant_added': 'Додано учасника',
      'task.participant_changed': 'Склад учасників змінено',
      'task.participant_removed': 'Вилучено учасника',
      'task.archived': 'Завдання архівовано',
      'task.approval_requested': 'Запитано погодження',
      'task.approval_approved': 'Завдання погоджено',
      'task.approval_needs_changes': 'Повернуто на доопрацювання',
      'task.approval_invalidated': 'Погодження втратило чинність через зміни',
    }
    return labels[action] ?? 'Завдання оновлено'
  }
}
