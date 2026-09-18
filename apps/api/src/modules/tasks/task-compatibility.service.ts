import { Injectable } from '@nestjs/common'
import {
  type StructuredMentionInput,
  type StructuredMentionView,
  type PageResult,
  type TaskActivityPage,
  type TaskAttachmentView,
  type TaskDetailView,
  type TaskCommentInput,
  type DeleteTaskCommentInput,
  type TaskListItem,
  type TaskReference,
  type TaskSourceLinkView,
  type TaskStatusTransitionInput,
  type UpdateTaskCommentInput,
} from '@lankadws/contracts'
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
import { TaskParticipantsService } from './task-participants.service.js'

const taskStatuses = [
  'NEW',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'ARCHIVED',
] as const
const activeTaskStatuses = ['NEW', 'IN_PROGRESS', 'IN_REVIEW'] as const
const terminalTaskStatuses = ['DONE', 'ARCHIVED'] as const
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
  requiresAcceptance?: boolean
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
        ? { status: 'NEW' }
        : preset === 'OVERDUE'
          ? { dueAt: { lt: now }, status: { notIn: [...terminalTaskStatuses] } }
          : preset === 'DUE_SOON'
            ? {
                dueAt: { gte: now, lte: new Date(now.getTime() + 72 * 60 * 60 * 1_000) },
                status: { notIn: [...terminalTaskStatuses] },
              }
            : null
    const roleWhere = this.roleWhere(principal.userId, viewRole)
    const search = filters.search?.trim().slice(0, 100)
    const where: Prisma.TaskWhereInput = {
      workspaceId: principal.workspaceId,
      companyId: { in: companyIds },
      archivedAt: null,
      AND: [
        roleWhere,
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
      AND: [responsibleWhere],
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
      OR: [{ dueAt: { lt: new Date() } }],
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
    const canEdit = this.canEdit(principal, task)
    const [comments, entityLinks, personalState, following, followerCount, reminders] = await Promise.all([
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
    const [attachedFiles, commentAuthors, commentReactions] = await Promise.all([
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
          isActive: true,
        },
      }),
      this.prisma.taskCommentReaction.findMany({
        where: { commentId: { in: comments.map((comment) => comment.id) }, kind: 'LIKE' },
        select: { commentId: true, userId: true },
      }),
    ])
    const filesById = new Map(attachedFiles.map((file) => [file.id, file]))
    const authorsById = new Map(commentAuthors.map((author) => [author.id, author]))
    const reactionsByComment = new Map<string, { likeCount: number; likedByMe: boolean }>()
    for (const reaction of commentReactions) {
      const current = reactionsByComment.get(reaction.commentId) ?? { likeCount: 0, likedByMe: false }
      current.likeCount += 1
      if (reaction.userId === principal.userId) current.likedByMe = true
      reactionsByComment.set(reaction.commentId, current)
    }
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
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
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
                mentionedUser?.isActive,
              ),
            }
          }),
        createdAt: comment.createdAt.toISOString(),
        editedAt: comment.editedAt?.toISOString() ?? null,
        version: comment.version,
        canEdit: isGlobalAdmin(principal),
        canDelete: isGlobalAdmin(principal),
        reactions: reactionsByComment.get(comment.id) ?? { likeCount: 0, likedByMe: false },
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
      requiresAcceptance: task.requiresAcceptance,
      availableStatusActions: this.availableStatusActions(principal, task, primaryResponsible.id),
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
    if (task.status === 'IN_REVIEW') throw conflict('task_review_locked')
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
        workspaceId: principal.workspaceId,
        isActive: true,
      },
      select: { id: true, displayName: true },
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
      ...(input.requiresAcceptance !== undefined && input.requiresAcceptance !== task.requiresAcceptance
        ? ['requiresAcceptance']
        : []),
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
          ...(input.requiresAcceptance === undefined ? {} : { requiresAcceptance: input.requiresAcceptance }),
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict('task_version')
      await tx.taskParticipant.updateMany({
        where: {
          taskId: task.id,
          userId: { not: input.assigneeId },
          role: 'RESPONSIBLE',
          removedAt: null,
        },
        data: { removedAt: new Date() },
      })
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
      await this.recordEvent(tx, principal, task, 'task.updated', input.expectedVersion + 1, {
        legacyCompatibility: true,
        changedFields,
        changes: {
          ...(title !== task.title ? { title } : {}),
          ...(description !== task.description ? { description: true } : {}),
          ...(currentResponsible?.role !== 'RESPONSIBLE' || currentResponsible.removedAt
            ? { assigneeId: input.assigneeId, assigneeName: users.find((user) => user.id === input.assigneeId)?.displayName }
            : {}),
          ...(reporterId !== task.reporterId
            ? { creatorId: reporterId, creatorName: users.find((user) => user.id === reporterId)?.displayName }
            : {}),
          ...(dueAt?.getTime() !== task.dueAt?.getTime() ? { deadline: dueAt?.toISOString() ?? null } : {}),
          ...(priority !== task.priority ? { priority } : {}),
          ...(blockReason !== (task.blockReason ?? '') ? { blockReason: Boolean(blockReason) } : {}),
          ...(input.requiresAcceptance !== undefined && input.requiresAcceptance !== task.requiresAcceptance
            ? { requiresAcceptance: input.requiresAcceptance }
            : {}),
        },
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

  async attachDriveFile(
    principal: AuthPrincipal,
    taskId: string,
    fileId: string,
  ): Promise<TaskAttachmentView> {
    const task = await this.access.readableTask(principal, taskId)
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        ownerId: principal.userId,
      },
    })
    if (!file) throw notFound()
    const existing = await this.prisma.fileLink.findUnique({
      where: {
        fileId_entityType_entityId_purpose: {
          fileId,
          entityType: 'TASK',
          entityId: task.id,
          purpose: 'ATTACHMENT',
        },
      },
    })
    if (existing) {
      return {
        id: file.id,
        fileName: file.safeFilename,
        bytes: file.bytes,
        mimeType: file.detectedMime ?? file.declaredMime,
        scanStatus: file.scanStatus,
        createdAt: file.createdAt.toISOString(),
        canRemove: true,
      }
    }
    const attachmentCount = await this.prisma.fileLink.count({
      where: {
        entityType: 'TASK',
        entityId: task.id,
        purpose: 'ATTACHMENT',
      },
    })
    if (attachmentCount >= 20) throw badRequest('task_attachment_limit')
    await this.prisma.$transaction(async (tx) => {
      await tx.fileLink.create({
        data: {
          id: id('fln'),
          fileId: file.id,
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
      await this.recordEvent(tx, principal, task, 'task.attachment_added', updated.version, {
        attachmentCount: 1,
        source: 'DRIVE',
      })
    })
    return {
      id: file.id,
      fileName: file.safeFilename,
      bytes: file.bytes,
      mimeType: file.detectedMime ?? file.declaredMime,
      scanStatus: file.scanStatus,
      createdAt: file.createdAt.toISOString(),
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
    if (file.ownerId !== principal.userId && !this.canEdit(principal, task)) throw notFound()
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
    const referencedUserIds = page.flatMap((event) => {
      try {
        const diff = JSON.parse(event.safeDiffJson) as { userId?: unknown }
        return typeof diff.userId === 'string' ? [diff.userId] : []
      } catch {
        return []
      }
    })
    const actors = await this.prisma.user.findMany({
      where: {
        id: {
          in: [...new Set([...page.flatMap((event) => event.actorId ? [event.actorId] : []), ...referencedUserIds])],
        },
      },
      select: { id: true, displayName: true, avatarAsset: true },
    })
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]))
    return {
      items: page.map((event) => ({
        id: event.id,
        action: event.action,
        label: this.activityLabel(event.action, event.safeDiffJson, actorsById),
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

  async transition(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskStatusTransitionInput,
  ): Promise<{ version: number; status: TaskStatusValue }> {
    const task = await this.access.readableTask(principal, taskId)
    if (task.version !== input.expectedVersion) throw conflict('task_version')
    const responsible = await this.prisma.taskParticipant.findFirst({
      where: { taskId, userId: principal.userId, role: 'RESPONSIBLE', removedAt: null },
      select: { id: true },
    })
    const isOwner = task.reporterId === principal.userId || isGlobalAdmin(principal)
    const isResponsible = Boolean(responsible) || isGlobalAdmin(principal)
    const nextStatus: TaskStatusValue = input.action === 'START'
      ? 'IN_PROGRESS'
      : input.action === 'COMPLETE'
        ? (task.requiresAcceptance ? 'IN_REVIEW' : 'DONE')
        : input.action === 'APPROVE' ? 'DONE' : 'IN_PROGRESS'
    const valid = (
      (input.action === 'START' && task.status === 'NEW' && isResponsible)
      || (input.action === 'COMPLETE' && task.status === 'IN_PROGRESS' && isResponsible)
      || (input.action === 'APPROVE' && task.status === 'IN_REVIEW' && isOwner)
      || (input.action === 'RETURN_TO_WORK' && task.status === 'IN_REVIEW' && isOwner)
    )
    if (!valid) throw forbidden()
    if (input.action === 'COMPLETE') {
      const blockers = await this.activeSubtaskIds(task.id)
      if (blockers.length) throw taskCompletionBlocked(blockers)
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, version: input.expectedVersion, status: task.status },
        data: {
          status: nextStatus,
          completedAt: nextStatus === 'DONE' ? new Date() : null,
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict('task_version')
      if (nextStatus === 'IN_REVIEW') {
        const last = await tx.taskApprovalRound.aggregate({ where: { taskId }, _max: { roundNumber: true } })
        await tx.taskApprovalRound.create({
          data: {
            id: id('tapr'), taskId, roundNumber: (last._max.roundNumber ?? 0) + 1,
            approverId: task.reporterId, requestedById: principal.userId,
            requestedTaskVersion: input.expectedVersion,
          },
        })
        if (task.reporterId !== principal.userId) {
          await tx.notification.upsert({
            where: { dedupeKey: `task-review:${task.id}:${input.expectedVersion + 1}` },
            create: {
              id: id('ntf'), recipientId: task.reporterId, category: 'TASKS',
              safeTitle: 'Завдання очікує на перевірку', safeSnippet: task.title.slice(0, 180),
              entityType: 'TASK', entityId: task.id, requiresAction: true, deliveredAt: new Date(),
              dedupeKey: `task-review:${task.id}:${input.expectedVersion + 1}`,
            }, update: {},
          })
        }
      }
      if (task.status === 'IN_REVIEW') {
        await tx.taskApprovalRound.updateMany({
          where: { taskId, status: 'PENDING' },
          data: input.action === 'APPROVE'
            ? { status: 'APPROVED', decidedAt: new Date(), resolutionTaskVersion: input.expectedVersion + 1 }
            : { status: 'NEEDS_CHANGES', decisionNote: input.action === 'RETURN_TO_WORK' ? input.note || null : null, decidedAt: new Date(), resolutionTaskVersion: input.expectedVersion + 1 },
        })
        if (input.action === 'RETURN_TO_WORK') {
          const responsibleParticipant = await tx.taskParticipant.findFirst({
            where: { taskId, role: 'RESPONSIBLE', removedAt: null },
            select: { userId: true },
          })
          if (responsibleParticipant && responsibleParticipant.userId !== principal.userId) {
            await tx.notification.upsert({
              where: { dedupeKey: `task-returned:${task.id}:${input.expectedVersion + 1}` },
              create: {
                id: id('ntf'), recipientId: responsibleParticipant.userId, category: 'TASKS',
                safeTitle: 'Завдання повернуто в роботу', safeSnippet: input.note || task.title.slice(0, 180),
                entityType: 'TASK', entityId: task.id, requiresAction: true, deliveredAt: new Date(),
                dedupeKey: `task-returned:${task.id}:${input.expectedVersion + 1}`,
              }, update: {},
            })
          }
        }
      }
      const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
      const participants = await tx.taskParticipant.findMany({ where: { taskId, removedAt: null }, select: { userId: true } })
      await this.feedProjection.projectTask(tx, updated, {
        action: 'STATUS_CHANGED', actorId: principal.userId, recipientIds: participants.map(({ userId }) => userId),
      })
      await this.recordEvent(tx, principal, task, 'task.status_changed', updated.version, {
        status: { from: task.status, to: nextStatus }, action: input.action, note: input.action === 'RETURN_TO_WORK' ? input.note || null : null,
      })
    })
    return { version: input.expectedVersion + 1, status: nextStatus }
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

  async reactToComment(
    principal: AuthPrincipal,
    taskId: string,
    commentId: string,
    liked: boolean,
  ): Promise<{ likeCount: number; likedByMe: boolean }> {
    const task = await this.access.readableTask(principal, taskId)
    const comment = await this.prisma.comment.findFirst({
      where: {
        id: commentId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        entityType: 'TASK',
        entityId: task.id,
        deletedAt: null,
      },
      select: { id: true, authorId: true },
    })
    if (!comment) throw notFound()
    if (liked) {
      const reaction = await this.prisma.taskCommentReaction.upsert({
        where: {
          commentId_userId_kind: { commentId: comment.id, userId: principal.userId, kind: 'LIKE' },
        },
        create: { id: id('tcr'), commentId: comment.id, userId: principal.userId, kind: 'LIKE' },
        update: {},
        select: { createdAt: true },
      })
      if (comment.authorId !== principal.userId) {
        const actor = await this.prisma.user.findFirst({
          where: { id: principal.userId, workspaceId: principal.workspaceId },
          select: { displayName: true },
        })
        await this.prisma.notification.upsert({
          where: { dedupeKey: `task-comment:${comment.id}:reaction:LIKE:${principal.userId}` },
          create: {
            id: id('ntf'),
            recipientId: comment.authorId,
            category: 'REACTION',
            safeTitle: `${actor?.displayName ?? 'Колега'} вподобав ваше повідомлення`,
            safeSnippet: task.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            deliveredAt: reaction.createdAt,
            dedupeKey: `task-comment:${comment.id}:reaction:LIKE:${principal.userId}`,
          },
          update: { readAt: null, deliveredAt: reaction.createdAt },
        })
      }
    } else {
      await this.prisma.taskCommentReaction.deleteMany({
        where: { commentId: comment.id, userId: principal.userId, kind: 'LIKE' },
      })
    }
    const [likeCount, ownReaction] = await Promise.all([
      this.prisma.taskCommentReaction.count({ where: { commentId: comment.id, kind: 'LIKE' } }),
      this.prisma.taskCommentReaction.findUnique({
        where: { commentId_userId_kind: { commentId: comment.id, userId: principal.userId, kind: 'LIKE' } },
        select: { id: true },
      }),
    ])
    return { likeCount, likedByMe: Boolean(ownReaction) }
  }

  async updateComment(
    principal: AuthPrincipal,
    taskId: string,
    commentId: string,
    input: UpdateTaskCommentInput,
  ): Promise<{ id: string; version: number; taskVersion: number; editedAt: string }> {
    const task = await this.access.readableTask(principal, taskId)
    if (!isGlobalAdmin(principal)) throw forbidden()
    const body = input.body.trim()
    if (!body || body.length > 4_000) throw badRequest('comment_body')
    const mentions = input.mentions.toSorted((left, right) => left.start - right.start || left.end - right.end)
    const mentionedUserIds = this.validateStructuredMentions(body, mentions)
    const comment = await this.prisma.comment.findFirst({
      where: {
        id: commentId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        entityType: 'TASK',
        entityId: task.id,
        deletedAt: null,
      },
      select: { id: true, version: true },
    })
    if (!comment) throw notFound()
    const editedAt = new Date()

    return this.prisma.$transaction(async (tx) => {
      const updatedComment = await tx.comment.updateMany({
        where: { id: comment.id, version: input.expectedVersion, deletedAt: null },
        data: {
          body,
          editedAt,
          version: { increment: 1 },
        },
      })
      if (!updatedComment.count) throw conflict('task_comment_version')
      await tx.contentMention.deleteMany({
        where: {
          workspaceId: principal.workspaceId,
          sourceType: 'TASK_COMMENT',
          sourceId: comment.id,
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
      const addedWatcherIds = await this.participants.ensureMentionWatchers(
        tx,
        principal,
        task,
        mentionedUserIds,
      )
      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      for (const recipientId of mentionedUserIds.filter((userId) => userId !== principal.userId)) {
        await tx.notification.upsert({
          where: {
            dedupeKey: `task-comment-edited:${comment.id}:${input.expectedVersion + 1}:${recipientId}`,
          },
          create: {
            id: id('ntf'),
            recipientId,
            category: 'MENTION',
            safeTitle: 'Вас згадали у відредагованому повідомленні',
            safeSnippet: task.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            deliveredAt: editedAt,
            dedupeKey: `task-comment-edited:${comment.id}:${input.expectedVersion + 1}:${recipientId}`,
          },
          update: {},
        })
      }
      await this.participants.recordMentionWatchersAdded(
        tx,
        principal,
        task,
        updatedTask.version,
        addedWatcherIds,
        null,
      )
      await this.recordEvent(tx, principal, task, 'task.comment_updated', updatedTask.version, {
        commentId: comment.id,
        mentionCount: mentionedUserIds.length,
        watcherAddedCount: addedWatcherIds.length,
      })
      return {
        id: comment.id,
        version: input.expectedVersion + 1,
        taskVersion: updatedTask.version,
        editedAt: editedAt.toISOString(),
      }
    })
  }

  async deleteComment(
    principal: AuthPrincipal,
    taskId: string,
    commentId: string,
    input: DeleteTaskCommentInput,
  ): Promise<{ id: string; deleted: true; taskVersion: number }> {
    const task = await this.access.readableTask(principal, taskId)
    if (!isGlobalAdmin(principal)) throw forbidden()
    const comment = await this.prisma.comment.findFirst({
      where: {
        id: commentId,
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
        entityType: 'TASK',
        entityId: task.id,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!comment) throw notFound()

    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.comment.updateMany({
        where: { id: comment.id, version: input.expectedVersion, deletedAt: null },
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      })
      if (!removed.count) throw conflict('task_comment_version')
      await Promise.all([
        tx.contentMention.deleteMany({
          where: {
            workspaceId: principal.workspaceId,
            sourceType: 'TASK_COMMENT',
            sourceId: comment.id,
          },
        }),
        tx.fileLink.deleteMany({
          where: {
            entityType: 'TASK_COMMENT',
            entityId: comment.id,
            purpose: 'ATTACHMENT',
          },
        }),
      ])
      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })
      await this.recordEvent(tx, principal, task, 'task.comment_deleted', updatedTask.version, {
        commentId: comment.id,
      })
      return { id: comment.id, deleted: true, taskVersion: updatedTask.version }
    })
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
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
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

  private canEdit(principal: AuthPrincipal, task: Task): boolean {
    return task.reporterId === principal.userId || isGlobalAdmin(principal)
  }

  private availableStatusActions(
    principal: AuthPrincipal,
    task: Task,
    responsibleId: string,
  ): Array<'START' | 'COMPLETE' | 'APPROVE' | 'RETURN_TO_WORK'> {
    const owner = task.reporterId === principal.userId || isGlobalAdmin(principal)
    const responsible = responsibleId === principal.userId || isGlobalAdmin(principal)
    if (task.status === 'NEW' && responsible) return ['START']
    if (task.status === 'IN_PROGRESS' && responsible) return ['COMPLETE']
    if (task.status === 'IN_REVIEW' && owner) return ['APPROVE', 'RETURN_TO_WORK']
    return []
  }

  private canManageReporter(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && isGlobalAdmin(principal)
  }

  private canManageResponsibles(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && (task.reporterId === principal.userId || isGlobalAdmin(principal))
  }

  private canManageParticipants(principal: AuthPrincipal, task: Task, canEdit: boolean): boolean {
    return canEdit && (task.reporterId === principal.userId || isGlobalAdmin(principal))
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
        workspaceId: principal.workspaceId,
        isActive: true,
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
              processType: 'OFFBOARDING',
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
        return [{
          id: link.id,
          kind: 'LIFECYCLE',
          label: 'Процес звільнення',
          href: `/offboarding/${encodeURIComponent(process.id)}?company=${encodeURIComponent(task.companyId)}`,
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

  private activityLabel(
    action: string,
    safeDiffJson: string,
    users = new Map<string, { displayName: string }>(),
  ): string {
    let diff: Record<string, unknown> = {}
    try {
      diff = JSON.parse(safeDiffJson) as Record<string, unknown>
    } catch {
      diff = {}
    }
    if (action === 'task.created') return 'Створено завдання'
    if (action === 'task.updated') {
      const fieldLabels: Record<string, string> = {
        title: 'назву', description: 'опис', assignee: 'відповідального', creator: 'постановника',
        reporterId: 'постановника', groupId: 'групу', projectId: 'проєкт', parentTaskId: 'батьківське завдання',
        deadline: 'строк', dueAt: 'строк', startsAt: 'дату початку', priority: 'пріоритет',
        estimatedMinutes: 'оцінку часу', blockReason: 'причину блокування', requiresAcceptance: 'налаштування перевірки',
      }
      const rawFields = Array.isArray(diff.changedFields) ? diff.changedFields : diff.fields
      const fields = Array.isArray(rawFields)
        ? rawFields
          .filter((field): field is string => typeof field === 'string')
          .map((field) => fieldLabels[field] ?? field)
        : []
      const changes = diff.changes as Record<string, unknown> | undefined
      const assigneeName = typeof changes?.assigneeName === 'string' ? changes.assigneeName : ''
      const creatorName = typeof changes?.creatorName === 'string' ? changes.creatorName : ''
      const title = typeof changes?.title === 'string' ? changes.title : ''
      const details = fields.map((field) => {
        if (field === 'назву' && title) return `назву на «${title}»`
        if (field === 'постановника' && creatorName) return `постановника на ${creatorName}`
        return field
      })
      if (assigneeName) {
        const otherChanges = details.filter((field) => field !== 'відповідального')
        return `Оновлено відповідального на ${assigneeName}${otherChanges.length ? `; ${otherChanges.join(', ')}` : ''}`
      }
      return details.length ? `Оновлено ${details.join(', ')}` : 'Оновлено завдання'
    }
    const labels: Record<string, string> = {
      'task.comment_created': 'Додано коментар',
      'task.comment_updated': 'Повідомлення відредаговано',
      'task.comment_deleted': 'Повідомлення видалено',
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
    if (action === 'task.status_changed') {
      const status = diff.status as { from?: string; to?: string } | undefined
      const labels: Record<string, string> = { NEW: 'Нове', IN_PROGRESS: 'В роботі', IN_REVIEW: 'На перевірці', DONE: 'Завершене', ARCHIVED: 'Архівоване' }
      return status?.from && status.to ? `Статус: ${labels[status.from] ?? status.from} → ${labels[status.to] ?? status.to}` : 'Статус змінено'
    }
    if (['task.participant_added', 'task.participant_removed', 'task.participant_changed'].includes(action)) {
      const userId = typeof diff.userId === 'string' ? diff.userId : ''
      const person = (users.get(userId)?.displayName ?? userId) || 'учасника'
      const roleLabels: Record<string, string> = { RESPONSIBLE: 'відповідальний', COLLABORATOR: 'співвиконавець', WATCHER: 'спостерігач' }
      const role = typeof diff.role === 'string' ? roleLabels[diff.role] ?? diff.role : 'учасник'
      return action === 'task.participant_removed' ? `Вилучено ${role}: ${person}` : `Змінено ${role}: ${person}`
    }
    return labels[action] ?? 'Завдання оновлено'
  }
}
