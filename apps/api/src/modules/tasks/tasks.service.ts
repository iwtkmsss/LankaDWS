import { Injectable } from '@nestjs/common'
import type {
  PageResult,
  TaskAttachmentView,
  TaskActivityPage,
  TaskDetailView,
  TaskListItem,
  TaskReference,
  TaskSourceLinkView,
  TaskViewRole,
} from '@bert-crm/contracts'
import type { EntityLink, FileObject, Prisma, Task } from '../../generated/prisma/client.js'
import { fingerprint, id } from '../../common/crypto.js'
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  taskCompletionBlocked,
} from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AuditService } from '../audit/audit.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FeedProjectionService } from '../feed/feed-projection.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { JobsService } from '../jobs/jobs.service.js'

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

const taskPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const terminalSubtaskStatuses = ['DONE', 'CANCELLED', 'ARCHIVED'] as const
const taskViewRoles = ['RESPONSIBLE', 'CO_EXECUTOR', 'CREATOR', 'OBSERVER', 'ALL'] as const
const taskParticipantRoles = ['CO_EXECUTOR', 'OBSERVER'] as const

type TaskStatusValue = typeof taskStatuses[number]
type TaskPriorityValue = typeof taskPriorities[number]
type TaskViewRoleValue = typeof taskViewRoles[number]
type TaskParticipantRoleValue = typeof taskParticipantRoles[number]
type TaskWithParent = Prisma.TaskGetPayload<{
  include: {
    parent: {
      select: {
        id: true
        number: true
        title: true
        status: true
      }
    }
  }
}>

export interface CreateTaskInput {
  companyId?: string
  groupId?: string
  title: string
  description?: string
  assigneeId: string
  deadline?: string
  priority?: TaskPriorityValue
  coExecutorIds?: string[]
  observerIds?: string[]
  related?: { type: string; id: string }
}

export interface CreateSubtaskInput {
  title: string
  description?: string
  assigneeId: string
  deadline?: string
  priority?: TaskPriorityValue
  expectedVersion: number
}

interface NormalizedTaskInput {
  title: string
  description: string
  assigneeId: string
  deadline: Date | null
  priority: TaskPriorityValue
}

export interface ChangeTaskParticipantInput {
  userId: string
  role: TaskParticipantRoleValue
  expectedVersion: number
}

export interface UpdateTaskInput {
  title: string
  description?: string
  assigneeId: string
  creatorId?: string
  deadline?: string | null
  priority: TaskPriorityValue
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

export interface TaskReminderInput {
  remindAt: string
}

export interface TaskCommentInput {
  body: string
  replyToCommentId?: string | null
  attachmentIds?: string[]
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly feedProjection: FeedProjectionService,
    private readonly taskAccess: TaskAccessService,
    private readonly files: FilesService,
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
    const companyIds = this.scope.allowedCompanies(principal, company)
    if (!taskViewRoles.includes(role as TaskViewRoleValue)) throw badRequest('task_role')
    const viewRole = role as TaskViewRoleValue
    if (viewRole === 'ALL' && !principal.permissions.has('tasks.manage')) throw forbidden()
    const roleWhere: Prisma.TaskWhereInput = viewRole === 'CREATOR'
      ? { creatorId: principal.userId }
      : viewRole === 'CO_EXECUTOR' || viewRole === 'OBSERVER'
        ? {
            participants: {
              some: {
                userId: principal.userId,
                role: viewRole,
                removedAt: null,
              },
            },
          }
        : viewRole === 'ALL'
          ? {}
          : { assigneeId: principal.userId }
    if (filters.status && !taskStatuses.includes(filters.status as TaskStatusValue)) {
      throw badRequest('task_status')
    }
    if (filters.priority && !taskPriorities.includes(filters.priority as TaskPriorityValue)) {
      throw badRequest('task_priority')
    }
    if (filters.favorite && !['true', 'false'].includes(filters.favorite)) {
      throw badRequest('task_favorite')
    }
    if (filters.important && !['true', 'false'].includes(filters.important)) {
      throw badRequest('task_important')
    }
    if (filters.overdue && filters.overdue !== 'true') {
      throw badRequest('task_overdue')
    }
    if (filters.preset && !['ACTIVE', 'DEFERRED', 'OVERDUE', 'DUE_SOON'].includes(filters.preset)) {
      throw badRequest('task_preset')
    }
    if (
      (filters.dueFrom && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dueFrom))
      || (filters.dueTo && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dueTo))
      || (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo)
    ) throw badRequest('task_due_range')
    const search = filters.search?.trim().slice(0, 100)
    const now = new Date()
    const preset = filters.preset ?? (filters.overdue === 'true' ? 'OVERDUE' : undefined)
    const presetWhere: Prisma.TaskWhereInput | null = preset === 'ACTIVE'
      ? { status: { in: ['NEW', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] } }
      : preset === 'DEFERRED'
        ? { status: 'PLANNED' }
        : preset === 'OVERDUE'
          ? { deadline: { lt: now }, status: { notIn: [...terminalSubtaskStatuses] } }
          : preset === 'DUE_SOON'
            ? {
                deadline: { gte: now, lte: new Date(now.getTime() + 72 * 60 * 60 * 1_000) },
                status: { notIn: [...terminalSubtaskStatuses] },
              }
            : null
    const dueFrom = filters.dueFrom ? new Date(`${filters.dueFrom}T00:00:00.000Z`) : null
    const dueTo = filters.dueTo ? new Date(`${filters.dueTo}T23:59:59.999Z`) : null
    const where: Prisma.TaskWhereInput = {
      companyId: { in: companyIds },
      archivedAt: null,
      AND: [
        {
          OR: [
            { groupId: null },
            { group: { members: { some: { userId: principal.userId, leftAt: null } } } },
          ],
        },
        roleWhere,
        ...(presetWhere ? [presetWhere] : []),
        ...(dueFrom || dueTo ? [{ deadline: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } }] : []),
        ...(filters.coExecutorId ? [{ participants: { some: { userId: filters.coExecutorId, role: 'CO_EXECUTOR' as const, removedAt: null } } }] : []),
        ...(filters.observerId ? [{ participants: { some: { userId: filters.observerId, role: 'OBSERVER' as const, removedAt: null } } }] : []),
      ],
      ...(search ? { OR: [{ title: { contains: search } }, { number: { contains: search } }] } : {}),
      ...(filters.status ? { status: filters.status as TaskStatusValue } : {}),
      ...(filters.priority ? { priority: filters.priority as TaskPriorityValue } : {}),
      ...(filters.groupId ? { groupId: filters.groupId } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.creatorId ? { creatorId: filters.creatorId } : {}),
      ...(filters.favorite === 'true'
        ? {
            userStates: {
              some: {
                userId: principal.userId,
                favoritedAt: { not: null },
              },
            },
          }
        : filters.favorite === 'false'
          ? {
              userStates: {
                none: {
                  userId: principal.userId,
                  favoritedAt: { not: null },
                },
              },
            }
          : {}),
      ...(filters.important === 'true'
        ? {
            userStates: {
              some: {
                userId: principal.userId,
                important: true,
              },
            },
          }
        : filters.important === 'false'
          ? {
              userStates: {
                none: {
                  userId: principal.userId,
                  important: true,
                },
              },
            }
          : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: {
          parent: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.task.count({ where }),
    ])
    return { items: await this.mapRows(rows, principal.userId), page, pageSize, total }
  }

  async detail(principal: AuthPrincipal, taskId: string): Promise<TaskDetailView> {
    const readable = await this.readableTask(principal, taskId)
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: readable.id },
      include: {
        checklist: { orderBy: { position: 'asc' } },
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
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
          orderBy: [{ role: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }],
        },
      },
    })
    const [
      creator,
      assignee,
      comments,
      entityLinks,
      personalState,
      following,
      followerCount,
      reminders,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: task.creatorId },
        select: { id: true, displayName: true },
      }),
      this.prisma.user.findUnique({
        where: { id: task.assigneeId },
        select: { id: true, displayName: true, avatarAsset: true },
      }),
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
        where: {
          taskId_userId: {
            taskId: task.id,
            userId: principal.userId,
          },
        },
        select: { favoritedAt: true, important: true },
      }),
      this.prisma.taskFollower.findUnique({
        where: {
          taskId_userId: {
            taskId: task.id,
            userId: principal.userId,
          },
        },
        select: { mutedAt: true },
      }),
      this.prisma.taskFollower.count({
        where: { taskId: task.id, mutedAt: null },
      }),
      this.prisma.taskReminder.findMany({
        where: {
          taskId: task.id,
          userId: principal.userId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          remindAt: true,
          status: true,
        },
        orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      }),
    ])
    const fileLinks = await this.prisma.fileLink.findMany({
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
    })
    const attachedFiles = await this.prisma.fileObject.findMany({
      where: {
        id: { in: [...new Set(fileLinks.map((link) => link.fileId))] },
        workspaceId: principal.workspaceId,
        companyId: task.companyId,
      },
    })
    const filesById = new Map(attachedFiles.map((file) => [file.id, file]))
    const commentAuthors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((comment) => comment.authorId))] } },
      select: { id: true, displayName: true, avatarAsset: true },
    })
    const authorsById = new Map(commentAuthors.map((author) => [author.id, author]))
    const subtasks = task.subtasks.map((subtask) => this.taskReference(subtask))
    const done = subtasks.filter((subtask) => this.isTerminalSubtask(subtask.status)).length
    const canEdit = await this.canEditTask(principal, task)
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
    const viewerRoles = this.viewerRoles(
      principal.userId,
      task,
      task.participants.map((participant) => ({
        userId: participant.userId,
        role: participant.role,
      })),
    )
    const participants = task.participants.map((participant) => ({
      id: participant.id,
      user: participant.user,
      role: participant.role,
      addedAt: participant.addedAt.toISOString(),
    }))
    return {
      id: task.id,
      number: task.number,
      companyId: task.companyId,
      parentTaskId: task.parentTaskId,
      title: task.title,
      description: task.description,
      blockReason: task.blockReason,
      creator: creator ?? { id: task.creatorId, displayName: 'Недоступний користувач' },
      assignee: assignee ?? {
        id: task.assigneeId,
        displayName: 'Недоступний користувач',
        avatarAsset: null,
      },
      status: task.status,
      priority: task.priority,
      deadline: task.deadline?.toISOString() ?? null,
      version: task.version,
      commentCount: comments.length,
      attachmentCount: taskAttachments.length,
      subtaskProgress: { done, total: subtasks.length },
      viewerRoles,
      checklist: task.checklist.map((item) => ({
        id: item.id,
        text: item.text,
        isDone: item.isDone,
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
      coExecutors: participants.filter((participant) => participant.role === 'CO_EXECUTOR'),
      observers: participants.filter((participant) => participant.role === 'OBSERVER'),
      canEdit,
      canReassign: this.canReassign(principal, task),
      canTransferCreator: principal.permissions.has('tasks.manage'),
      canCreateSubtask: !task.parentTaskId
        && !this.isTerminalSubtask(task.status)
        && principal.permissions.has('tasks.create')
        && canEdit,
      canManageParticipants: this.canManageParticipants(principal, task),
      canAttachFiles: true,
      personalState: {
        favorited: Boolean(personalState?.favoritedAt),
        important: personalState?.important ?? false,
        following: Boolean(following && !following.mutedAt),
        followerCount,
        reminders: reminders.map((reminder) => ({
          id: reminder.id,
          remindAt: reminder.remindAt.toISOString(),
          status: reminder.status,
        })),
      },
    }
  }

  async uploadAttachment(
    principal: AuthPrincipal,
    taskId: string,
    file: UploadedBinary,
  ): Promise<TaskAttachmentView> {
    const task = await this.readableTask(principal, taskId)
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
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.attachment_added',
          entityType: 'TASK',
          entityId: task.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({ attachmentCount: 1 }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: task.id,
          aggregateVersion: updated.version,
          eventType: 'task.attachment_added',
          safePayload: JSON.stringify({
            taskId: task.id,
            companyId: task.companyId,
            attachmentCount: 1,
          }),
        },
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
    const task = await this.readableTask(principal, taskId)
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
    if (file.ownerId !== principal.userId && !await this.canEditTask(principal, task)) {
      throw notFound()
    }

    const commentIds = await this.prisma.comment.findMany({
      where: {
        entityType: 'TASK',
        entityId: task.id,
      },
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
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.attachment_removed',
          entityType: 'TASK',
          entityId: task.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({ attachmentCount: -1 }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: task.id,
          aggregateVersion: updated.version,
          eventType: 'task.attachment_removed',
          safePayload: JSON.stringify({
            taskId: task.id,
            companyId: task.companyId,
            attachmentCount: -1,
          }),
        },
      })
    })
    return { id: fileId, removed: true }
  }

  async updateTask(
    principal: AuthPrincipal,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<{ version: number }> {
    const task = await this.editableTask(principal, taskId)
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest('task_version')
    }
    if (task.version !== input.expectedVersion) {
      throw conflict(`Поточна версія: ${task.version}`)
    }
    const normalized = await this.normalizeTaskInput(task.companyId, input, task.groupId)
    if (normalized.assigneeId !== task.assigneeId && !this.canReassign(principal, task)) {
      throw notFound()
    }
    const creatorId = input.creatorId ?? task.creatorId
    if (creatorId !== task.creatorId) {
      if (!principal.permissions.has('tasks.manage')) throw notFound()
      const creator = await this.prisma.user.findFirst({
        where: {
          id: creatorId,
          status: 'ACTIVE',
          companyAccess: { some: { companyId: task.companyId, status: 'ACTIVE' } },
          ...(task.groupId
            ? { groupMemberships: { some: { groupId: task.groupId, leftAt: null } } }
            : {}),
        },
        select: { id: true },
      })
      if (!creator) throw badRequest('task_creator')
    }
    const blockReason = typeof input.blockReason === 'string'
      ? input.blockReason.trim()
      : ''
    if (blockReason.length > 1000) throw badRequest('task_block_reason')
    const nextDeadline = normalized.deadline?.getTime() ?? null
    const previousDeadline = task.deadline?.getTime() ?? null
    const changedFields = [
      ...(normalized.title !== task.title ? ['title'] : []),
      ...(normalized.description !== task.description ? ['description'] : []),
      ...(normalized.assigneeId !== task.assigneeId ? ['assignee'] : []),
      ...(creatorId !== task.creatorId ? ['creator'] : []),
      ...(nextDeadline !== previousDeadline ? ['deadline'] : []),
      ...(normalized.priority !== task.priority ? ['priority'] : []),
      ...(blockReason !== (task.blockReason ?? '') ? ['blockReason'] : []),
    ]
    if (!changedFields.length) return { version: task.version }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, version: input.expectedVersion },
        data: {
          title: normalized.title,
          description: normalized.description,
          assigneeId: normalized.assigneeId,
          creatorId,
          deadline: normalized.deadline,
          priority: normalized.priority,
          blockReason: blockReason || null,
          version: { increment: 1 },
        },
      })
      if (!result.count) throw conflict()
      const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
      if (task.parentTaskId) {
        await tx.task.update({
          where: { id: task.parentTaskId },
          data: { version: { increment: 1 } },
        })
      }
      const possiblyRevokedUserIds = [...new Set([
        ...(normalized.assigneeId !== task.assigneeId ? [task.assigneeId] : []),
        ...(creatorId !== task.creatorId ? [task.creatorId] : []),
      ])]
      for (const userId of possiblyRevokedUserIds) {
        if (updated.creatorId === userId || updated.assigneeId === userId) continue
        const remainingRole = await tx.taskParticipant.findFirst({
          where: { taskId: task.id, userId, removedAt: null },
          select: { id: true },
        })
        if (remainingRole) continue
        await tx.taskFollower.updateMany({
          where: { taskId: task.id, userId, mutedAt: null },
          data: { mutedAt: now },
        })
        const activeReminders = await tx.taskReminder.findMany({
          where: { taskId: task.id, userId, status: 'ACTIVE' },
          select: { id: true },
        })
        if (!activeReminders.length) continue
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
      let feedItemId: string | null = null
      if (normalized.assigneeId !== task.assigneeId) {
        const activeParticipants = await tx.taskParticipant.findMany({
          where: { taskId: task.id, removedAt: null },
          select: { userId: true },
        })
        feedItemId = await this.feedProjection.projectTask(tx, updated, {
          action: 'ASSIGNED',
          actorId: principal.userId,
          recipientIds: activeParticipants.map((participant) => participant.userId),
        })
        await tx.notification.upsert({
          where: {
            dedupeKey: `task-assigned:${task.id}:v${updated.version}:${normalized.assigneeId}`,
          },
          create: {
            id: id('ntf'),
            recipientId: normalized.assigneeId,
            category: 'TASKS',
            safeTitle: 'Вам доручили завдання',
            safeSnippet: normalized.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            requiresAction: true,
            deliveredAt: now,
            dedupeKey: `task-assigned:${task.id}:v${updated.version}:${normalized.assigneeId}`,
          },
          update: {},
        })
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.updated',
          entityType: 'TASK',
          entityId: task.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({
            changedFields,
            ...(normalized.assigneeId !== task.assigneeId
              ? { assigneeId: normalized.assigneeId }
              : {}),
            ...(creatorId !== task.creatorId ? { creatorId } : {}),
          }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: task.id,
          aggregateVersion: updated.version,
          eventType: 'task.updated',
          safePayload: JSON.stringify({
            taskId: task.id,
            companyId: task.companyId,
            changedFields,
            feedItemId,
          }),
        },
      })
    })
    return { version: input.expectedVersion + 1 }
  }

  async activity(
    principal: AuthPrincipal,
    taskId: string,
    cursor?: string,
  ): Promise<TaskActivityPage> {
    const task = await this.readableTask(principal, taskId)
    const cursorEvent = cursor
      ? await this.prisma.auditEvent.findFirst({
          where: {
            id: cursor,
            entityType: 'TASK',
            entityId: task.id,
          },
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
      select: {
        id: true,
        displayName: true,
        avatarAsset: true,
      },
    })
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]))
    return {
      items: page.map((event) => ({
        id: event.id,
        action: event.action,
        label: this.taskActivityLabel(event.action, event.safeDiffJson),
        actor: event.actorId ? actorsById.get(event.actorId) ?? null : null,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 20 ? page.at(-1)?.id ?? null : null,
    }
  }

  async create(
    principal: AuthPrincipal,
    input: CreateTaskInput,
    idempotencyKey: string,
  ): Promise<{ id: string; number: string }> {
    const companyId = this.scope.assertCompany(principal, input.companyId)
    const groupId = typeof input.groupId === 'string' && input.groupId.trim()
      ? input.groupId.trim()
      : null
    if (groupId) {
      const group = await this.prisma.group.findFirst({
        where: {
          id: groupId,
          workspaceId: principal.workspaceId,
          companyId,
          status: 'ACTIVE',
          members: { some: { userId: principal.userId, leftAt: null } },
        },
        select: { id: true },
      })
      if (!group) throw notFound()
    }
    const normalized = await this.normalizeTaskInput(companyId, input, groupId)
    const related = await this.normalizeTaskRelated(principal, companyId, input.related)
    const participantIds = await this.normalizeParticipantIds(
      companyId,
      groupId,
      input.coExecutorIds,
      input.observerIds,
    )
    const requestFingerprint = this.taskFingerprint('task.create', {
      companyId,
      groupId,
      ...normalized,
      deadline: normalized.deadline?.toISOString() ?? null,
      coExecutorIds: participantIds.coExecutorIds,
      observerIds: participantIds.observerIds,
      related,
    })
    const existing = await this.idempotentTask(
      principal.userId,
      idempotencyKey,
      'task.create',
      requestFingerprint,
    )
    if (existing) return existing
    const taskId = id('tsk')
    const number = this.taskNumber()
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          id: taskId,
          workspaceId: principal.workspaceId,
          companyId,
          groupId,
          number,
          title: normalized.title,
          description: normalized.description,
          creatorId: principal.userId,
          assigneeId: normalized.assigneeId,
          deadline: normalized.deadline,
          priority: normalized.priority,
        },
      })
      if (related) {
        await tx.entityLink.create({
          data: {
            id: id('lnk'),
            sourceType: 'TASK',
            sourceId: taskId,
            targetType: related.type,
            targetId: related.id,
            relation: 'RELATED',
            createdBy: principal.userId,
          },
        })
      }
      const participantRows = [
        ...participantIds.coExecutorIds.map((userId) => ({
          id: id('tpart'),
          taskId,
          userId,
          role: 'CO_EXECUTOR' as const,
          addedById: principal.userId,
        })),
        ...participantIds.observerIds.map((userId) => ({
          id: id('tpart'),
          taskId,
          userId,
          role: 'OBSERVER' as const,
          addedById: principal.userId,
        })),
      ]
      if (participantRows.length) {
        await tx.taskParticipant.createMany({ data: participantRows })
      }
      const feedItemId = await this.feedProjection.projectTask(tx, task, {
        action: 'ASSIGNED',
        occurredAt: task.createdAt,
        recipientIds: participantRows.map((participant) => participant.userId),
      })
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation: 'task.create',
          requestFingerprint,
          resultType: 'TASK',
          resultId: taskId,
          responseStatus: 201,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.created',
          entityType: 'TASK',
          entityId: taskId,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: taskId,
          aggregateVersion: task.version,
          eventType: 'task.created',
          safePayload: JSON.stringify({ taskId, companyId, feedItemId }),
        },
      })
    })
    return { id: taskId, number }
  }

  async createSubtask(
    principal: AuthPrincipal,
    parentTaskId: string,
    input: CreateSubtaskInput,
    idempotencyKey: string,
  ): Promise<{ id: string; number: string; parentTaskId: string; parentVersion: number }> {
    const operation = `task.subtask.create:${parentTaskId}`
    const parent = await this.editableTask(principal, parentTaskId)
    const normalized = await this.normalizeTaskInput(parent.companyId, input, parent.groupId)
    const requestFingerprint = this.taskFingerprint(operation, {
      parentTaskId,
      expectedVersion: input.expectedVersion,
      ...normalized,
      deadline: normalized.deadline?.toISOString() ?? null,
    })
    const existing = await this.idempotentTask(
      principal.userId,
      idempotencyKey,
      operation,
      requestFingerprint,
    )
    if (existing) {
      const parent = await this.prisma.task.findUnique({
        where: { id: parentTaskId },
        select: { version: true },
      })
      return {
        ...existing,
        parentTaskId,
        parentVersion: parent?.version ?? input.expectedVersion + 1,
      }
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest('task_version')
    }
    if (parent.parentTaskId) throw badRequest('task_subtask_depth')
    if (this.isTerminalSubtask(parent.status)) throw conflict('Закрите завдання не може мати нові підзадачі.')
    if (parent.version !== input.expectedVersion) {
      throw conflict(`Поточна версія: ${parent.version}`)
    }
    const taskId = id('tsk')
    const number = this.taskNumber()
    await this.prisma.$transaction(async (tx) => {
      const parentUpdate = await tx.task.updateMany({
        where: { id: parent.id, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!parentUpdate.count) throw conflict()
      const task = await tx.task.create({
        data: {
          id: taskId,
          workspaceId: parent.workspaceId,
          companyId: parent.companyId,
          groupId: parent.groupId,
          parentTaskId: parent.id,
          number,
          title: normalized.title,
          description: normalized.description,
          creatorId: principal.userId,
          assigneeId: normalized.assigneeId,
          deadline: normalized.deadline,
          priority: normalized.priority,
        },
      })
      const feedItemId = await this.feedProjection.projectTask(tx, task, {
        action: 'ASSIGNED',
        occurredAt: task.createdAt,
      })
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'TASK',
          resultId: task.id,
          responseStatus: 201,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: parent.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.subtask_created',
          entityType: 'TASK',
          entityId: parent.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({ subtaskId: task.id }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: parent.id,
          aggregateVersion: input.expectedVersion + 1,
          eventType: 'task.subtask_created',
          safePayload: JSON.stringify({
            taskId: parent.id,
            subtaskId: task.id,
            companyId: parent.companyId,
            feedItemId,
          }),
        },
      })
    })
    return {
      id: taskId,
      number,
      parentTaskId: parent.id,
      parentVersion: input.expectedVersion + 1,
    }
  }

  async addParticipant(
    principal: AuthPrincipal,
    taskId: string,
    input: ChangeTaskParticipantInput,
    idempotencyKey: string,
  ): Promise<{ id: string; userId: string; role: TaskParticipantRoleValue; version: number }> {
    const task = await this.manageableTask(principal, taskId)
    this.assertParticipantInput(input)
    const operation = `task.participant.add:${task.id}`
    const requestFingerprint = this.taskFingerprint(operation, {
      userId: input.userId,
      role: input.role,
      expectedVersion: input.expectedVersion,
    })
    const existingRequest = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation,
        },
      },
    })
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== requestFingerprint) {
        throw conflict('Цей ключ повтору вже використано для іншого запиту.')
      }
      if (existingRequest.resultId) {
        return {
          id: existingRequest.resultId,
          userId: input.userId,
          role: input.role,
          version: input.expectedVersion + 1,
        }
      }
    }
    if (task.version !== input.expectedVersion) {
      throw conflict(`Поточна версія: ${task.version}`)
    }
    await this.normalizeParticipantIds(
      task.companyId,
      task.groupId,
      input.role === 'CO_EXECUTOR' ? [input.userId] : [],
      input.role === 'OBSERVER' ? [input.userId] : [],
    )
    const duplicate = await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId: input.userId,
        role: input.role,
        removedAt: null,
      },
      select: { id: true },
    })
    if (duplicate) throw conflict('Ця людина вже має обрану роль у завданні.')
    const participantId = id('tpart')
    const now = new Date()
    try {
      await this.prisma.$transaction(async (tx) => {
        const taskUpdate = await tx.task.updateMany({
          where: { id: task.id, version: input.expectedVersion },
          data: { version: { increment: 1 } },
        })
        if (!taskUpdate.count) throw conflict()
        await tx.taskParticipant.create({
          data: {
            id: participantId,
            taskId: task.id,
            userId: input.userId,
            role: input.role,
            addedById: principal.userId,
          },
        })
        const [updated, activeParticipants] = await Promise.all([
          tx.task.findUniqueOrThrow({ where: { id: task.id } }),
          tx.taskParticipant.findMany({
            where: { taskId: task.id, removedAt: null },
            select: { userId: true },
          }),
        ])
        const feedItemId = await this.feedProjection.projectTask(tx, updated, {
          action: 'PARTICIPANT_CHANGED',
          actorId: principal.userId,
          recipientIds: activeParticipants.map((participant) => participant.userId),
        })
        await tx.idempotencyRecord.create({
          data: {
            id: id('idem'),
            userId: principal.userId,
            key: idempotencyKey,
            operation,
            requestFingerprint,
            resultType: 'TASK_PARTICIPANT',
            resultId: participantId,
            responseStatus: 201,
            expiresAt: new Date(now.getTime() + 86_400_000),
          },
        })
        await tx.notification.upsert({
          where: { dedupeKey: `task-participant:${participantId}:added:${input.userId}` },
          create: {
            id: id('ntf'),
            recipientId: input.userId,
            category: 'TASKS',
            safeTitle: input.role === 'CO_EXECUTOR'
              ? 'Вас додали як співвиконавця'
              : 'Вас додали як спостерігача',
            safeSnippet: task.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            requiresAction: false,
            deliveredAt: now,
            dedupeKey: `task-participant:${participantId}:added:${input.userId}`,
          },
          update: {},
        })
        await tx.auditEvent.create({
          data: {
            id: id('aud'),
            workspaceId: principal.workspaceId,
            companyId: task.companyId,
            actorType: 'USER',
            actorId: principal.userId,
            action: 'task.participant_added',
            entityType: 'TASK',
            entityId: task.id,
            result: 'SUCCESS',
            risk: 'NORMAL',
            correlationId: id('corr'),
            safeDiffJson: JSON.stringify({
              userId: input.userId,
              role: input.role,
            }),
          },
        })
        await tx.outboxEvent.create({
          data: {
            id: id('out'),
            aggregateType: 'TASK',
            aggregateId: task.id,
            aggregateVersion: updated.version,
            eventType: 'task.participant_changed',
            safePayload: JSON.stringify({
              taskId: task.id,
              companyId: task.companyId,
              userId: input.userId,
              role: input.role,
              change: 'ADDED',
              feedItemId,
            }),
          },
        })
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        throw conflict('Ця людина вже має обрану роль у завданні.')
      }
      throw error
    }
    return {
      id: participantId,
      userId: input.userId,
      role: input.role,
      version: input.expectedVersion + 1,
    }
  }

  async removeParticipant(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
    role: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const task = await this.manageableTask(principal, taskId)
    if (!taskParticipantRoles.includes(role as TaskParticipantRoleValue)) {
      throw badRequest('task_participant_role')
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw badRequest('task_version')
    }
    if (task.version !== expectedVersion) {
      throw conflict(`Поточна версія: ${task.version}`)
    }
    const participant = await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId,
        role: role as TaskParticipantRoleValue,
        removedAt: null,
      },
      select: { id: true },
    })
    if (!participant) throw notFound()
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const taskUpdate = await tx.task.updateMany({
        where: { id: task.id, version: expectedVersion },
        data: { version: { increment: 1 } },
      })
      if (!taskUpdate.count) throw conflict()
      const removed = await tx.taskParticipant.updateMany({
        where: { id: participant.id, removedAt: null },
        data: { removedAt: now },
      })
      if (!removed.count) throw conflict()
      const remainingRole = await tx.taskParticipant.findFirst({
        where: {
          taskId: task.id,
          userId,
          removedAt: null,
        },
        select: { id: true },
      })
      if (
        !remainingRole
        && task.creatorId !== userId
        && task.assigneeId !== userId
      ) {
        await tx.taskFollower.updateMany({
          where: { taskId: task.id, userId, mutedAt: null },
          data: { mutedAt: now },
        })
        const activeReminders = await tx.taskReminder.findMany({
          where: { taskId: task.id, userId, status: 'ACTIVE' },
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
      }
      const [updated, activeParticipants] = await Promise.all([
        tx.task.findUniqueOrThrow({ where: { id: task.id } }),
        tx.taskParticipant.findMany({
          where: { taskId: task.id, removedAt: null },
          select: { userId: true },
        }),
      ])
      const feedItemId = await this.feedProjection.projectTask(tx, updated, {
        action: 'PARTICIPANT_CHANGED',
        actorId: principal.userId,
        recipientIds: activeParticipants.map((entry) => entry.userId),
      })
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.participant_removed',
          entityType: 'TASK',
          entityId: task.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({ userId, role }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: task.id,
          aggregateVersion: updated.version,
          eventType: 'task.participant_changed',
          safePayload: JSON.stringify({
            taskId: task.id,
            companyId: task.companyId,
            userId,
            role,
            change: 'REMOVED',
            feedItemId,
          }),
        },
      })
    })
    return { version: expectedVersion + 1 }
  }

  async setUserState(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskUserStateInput,
    idempotencyKey: string,
  ): Promise<{ favorited: boolean; important: boolean }> {
    const task = await this.readableTask(principal, taskId)
    if (
      (input.favorited === undefined && input.important === undefined)
      || (input.favorited !== undefined && typeof input.favorited !== 'boolean')
      || (input.important !== undefined && typeof input.important !== 'boolean')
    ) {
      throw badRequest('task_user_state')
    }
    const current = await this.prisma.taskUserState.findUnique({
      where: {
        taskId_userId: {
          taskId: task.id,
          userId: principal.userId,
        },
      },
    })
    const favorited = input.favorited ?? Boolean(current?.favoritedAt)
    const important = input.important ?? current?.important ?? false
    const operation = `task.user-state:${task.id}`
    const requestFingerprint = this.taskFingerprint(operation, {
      favorited: input.favorited ?? null,
      important: input.important ?? null,
    })
    const existingRequest = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation,
        },
      },
    })
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== requestFingerprint) {
        throw conflict('Цей ключ повтору вже використано для іншого запиту.')
      }
      return { favorited, important }
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const state = await tx.taskUserState.upsert({
        where: {
          taskId_userId: {
            taskId: task.id,
            userId: principal.userId,
          },
        },
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
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'TASK_USER_STATE',
          resultId: state.id,
          responseStatus: 200,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
    })
    return { favorited, important }
  }

  async followTask(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskFollowerInput,
    idempotencyKey: string,
  ): Promise<{ userId: string; following: true }> {
    const task = await this.readableTask(principal, taskId)
    const userId = input.userId ?? principal.userId
    await this.assertFollowerTarget(principal, task, userId)
    const operation = `task.follower.add:${task.id}`
    const requestFingerprint = this.taskFingerprint(operation, { userId })
    const existingRequest = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation,
        },
      },
    })
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== requestFingerprint) {
        throw conflict('Цей ключ повтору вже використано для іншого запиту.')
      }
      return { userId, following: true }
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const follower = await tx.taskFollower.upsert({
        where: {
          taskId_userId: {
            taskId: task.id,
            userId,
          },
        },
        create: {
          id: id('tfol'),
          taskId: task.id,
          userId,
        },
        update: { mutedAt: null },
      })
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'TASK_FOLLOWER',
          resultId: follower.id,
          responseStatus: 201,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
    })
    return { userId, following: true }
  }

  async unfollowTask(
    principal: AuthPrincipal,
    taskId: string,
    userId: string,
  ): Promise<{ userId: string; following: false }> {
    const task = await this.readableTask(principal, taskId)
    await this.assertFollowerTarget(principal, task, userId)
    const now = new Date()
    await this.prisma.taskFollower.upsert({
      where: {
        taskId_userId: {
          taskId: task.id,
          userId,
        },
      },
      create: {
        id: id('tfol'),
        taskId: task.id,
        userId,
        mutedAt: now,
      },
      update: { mutedAt: now },
    })
    return { userId, following: false }
  }

  async createReminder(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskReminderInput,
    idempotencyKey: string,
  ): Promise<{
    id: string
    remindAt: string
    status: 'ACTIVE' | 'SENT' | 'CANCELLED'
  }> {
    const task = await this.readableTask(principal, taskId)
    const remindAt = new Date(input.remindAt)
    const latestAllowed = new Date()
    latestAllowed.setUTCFullYear(latestAllowed.getUTCFullYear() + 5)
    if (
      Number.isNaN(remindAt.getTime())
      || remindAt <= new Date()
      || remindAt > latestAllowed
    ) {
      throw badRequest('task_reminder_time')
    }
    const operation = `task.reminder.create:${task.id}`
    const requestFingerprint = this.taskFingerprint(operation, {
      remindAt: remindAt.toISOString(),
    })
    const existingRequest = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_key_operation: {
          userId: principal.userId,
          key: idempotencyKey,
          operation,
        },
      },
    })
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== requestFingerprint) {
        throw conflict('Цей ключ повтору вже використано для іншого запиту.')
      }
      const reminder = existingRequest.resultId
        ? await this.prisma.taskReminder.findUnique({
            where: { id: existingRequest.resultId },
          })
        : null
      if (reminder) {
        return {
          id: reminder.id,
          remindAt: reminder.remindAt.toISOString(),
          status: reminder.status,
        }
      }
    }
    const duplicate = await this.prisma.taskReminder.findFirst({
      where: {
        taskId: task.id,
        userId: principal.userId,
        remindAt,
        status: 'ACTIVE',
      },
    })
    const reminderId = duplicate?.id ?? id('trm')
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (!duplicate) {
        await tx.taskReminder.create({
          data: {
            id: reminderId,
            taskId: task.id,
            userId: principal.userId,
            remindAt,
          },
        })
        await tx.backgroundJob.create({
          data: {
            id: id('job'),
            type: 'task.reminder',
            entityType: 'TASK_REMINDER',
            entityId: reminderId,
            safePayload: JSON.stringify({
              taskId: task.id,
              userId: principal.userId,
            }),
            idempotencyKey: `task-reminder:${reminderId}`,
            runAt: remindAt,
          },
        })
      }
      await tx.idempotencyRecord.create({
        data: {
          id: id('idem'),
          userId: principal.userId,
          key: idempotencyKey,
          operation,
          requestFingerprint,
          resultType: 'TASK_REMINDER',
          resultId: reminderId,
          responseStatus: 201,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
    })
    return {
      id: reminderId,
      remindAt: remindAt.toISOString(),
      status: 'ACTIVE',
    }
  }

  async cancelReminder(
    principal: AuthPrincipal,
    taskId: string,
    reminderId: string,
  ): Promise<{ id: string; status: 'SENT' | 'CANCELLED' }> {
    const task = await this.readableTask(principal, taskId)
    const reminder = await this.prisma.taskReminder.findFirst({
      where: {
        id: reminderId,
        taskId: task.id,
        userId: principal.userId,
      },
    })
    if (!reminder) throw notFound()
    if (reminder.status === 'ACTIVE') {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskReminder.updateMany({
          where: { id: reminder.id, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        })
        await tx.backgroundJob.updateMany({
          where: {
            type: 'task.reminder',
            entityId: reminder.id,
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

  async changeStatus(
    principal: AuthPrincipal,
    taskId: string,
    status: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    if (!taskStatuses.includes(status as TaskStatusValue)) throw badRequest('task_status')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw badRequest('task_version')
    const nextStatus = status as TaskStatusValue
    const task = await this.editableTask(principal, taskId)
    if (task.version !== expectedVersion) throw conflict(`Поточна версія: ${task.version}`)
    if (nextStatus === 'DONE') {
      const blockers = await this.activeSubtaskIds(task.id)
      if (blockers.length) throw taskCompletionBlocked(blockers)
    }
    try {
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
        if (!result.count) throw conflict()
        const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
        if (task.parentTaskId) {
          await tx.task.update({
            where: { id: task.parentTaskId },
            data: { version: { increment: 1 } },
          })
        }
        const sourceAction = nextStatus === 'BLOCKED'
          ? 'BLOCKED'
          : task.status === 'BLOCKED'
            ? 'UNBLOCKED'
            : null
        let feedItemId: string | null = null
        if (sourceAction) {
          const activeParticipants = await tx.taskParticipant.findMany({
            where: { taskId: task.id, removedAt: null },
            select: { userId: true },
          })
          feedItemId = await this.feedProjection.projectTask(tx, updated, {
            action: sourceAction,
            actorId: principal.userId,
            recipientIds: activeParticipants.map((participant) => participant.userId),
          })
        }
        await tx.auditEvent.create({
          data: {
            id: id('aud'),
            workspaceId: principal.workspaceId,
            companyId: task.companyId,
            actorType: 'USER',
            actorId: principal.userId,
            action: 'task.status_changed',
            entityType: 'TASK',
            entityId: task.id,
            result: 'SUCCESS',
            risk: 'NORMAL',
            correlationId: id('corr'),
            safeDiffJson: JSON.stringify({ status: { from: task.status, to: nextStatus } }),
          },
        })
        await tx.outboxEvent.create({
          data: {
            id: id('out'),
            aggregateType: 'TASK',
            aggregateId: task.id,
            aggregateVersion: updated.version,
            eventType: 'task.status_changed',
            safePayload: JSON.stringify({
              taskId: task.id,
              companyId: task.companyId,
              status: nextStatus,
              parentTaskId: task.parentTaskId,
              feedItemId,
            }),
          },
        })
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('task_active_subtasks')) {
        throw taskCompletionBlocked(await this.activeSubtaskIds(task.id))
      }
      throw error
    }
    return { version: expectedVersion + 1 }
  }

  async addComment(
    principal: AuthPrincipal,
    taskId: string,
    input: TaskCommentInput,
  ) {
    const task = await this.readableTask(principal, taskId)
    const text = typeof input.body === 'string' ? input.body.trim() : ''
    if (!text || text.length > 4000) throw badRequest('comment_body')
    const replyToCommentId = typeof input.replyToCommentId === 'string'
      ? input.replyToCommentId.trim()
      : null
    if (replyToCommentId && replyToCommentId.length > 120) {
      throw badRequest('task_comment_reply')
    }
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? [...new Set(input.attachmentIds.map((fileId) => (
          typeof fileId === 'string' ? fileId.trim() : ''
        )))]
      : []
    if (
      attachmentIds.length > 5
      || attachmentIds.some((fileId) => !fileId || fileId.length > 120)
    ) {
      throw badRequest('task_comment_attachments')
    }
    const [replyTarget, attachmentLinks, attachmentFiles] = await Promise.all([
      replyToCommentId
        ? this.prisma.comment.findFirst({
            where: {
              id: replyToCommentId,
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              entityType: 'TASK',
              entityId: task.id,
              deletedAt: null,
            },
            select: {
              id: true,
              authorId: true,
              replyToCommentId: true,
            },
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
      attachmentIds.length
        ? this.prisma.fileObject.findMany({
            where: {
              id: { in: attachmentIds },
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
              scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
            },
            select: { id: true },
          })
        : [],
    ])
    if (replyToCommentId && (!replyTarget || replyTarget.replyToCommentId)) {
      throw badRequest('task_comment_reply')
    }
    if (
      attachmentLinks.length !== attachmentIds.length
      || attachmentFiles.length !== attachmentIds.length
    ) {
      throw badRequest('task_comment_attachments')
    }
    const commentId = id('cmt')
    const now = new Date()
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          id: commentId,
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          entityType: 'TASK',
          entityId: task.id,
          authorId: principal.userId,
          body: text,
          visibility: 'PARTICIPANTS',
          replyToCommentId,
        },
      })
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
      const [participants, followers] = await Promise.all([
        tx.taskParticipant.findMany({
          where: {
            taskId: task.id,
            removedAt: null,
          },
          select: { userId: true, role: true },
        }),
        tx.taskFollower.findMany({
          where: {
            taskId: task.id,
            mutedAt: null,
            userId: { not: principal.userId },
          },
          select: { userId: true },
        }),
      ])
      const followerIds = followers.map((follower) => follower.userId)
      const directUserIds = [...new Set([
        task.creatorId,
        task.assigneeId,
        ...participants.map((participant) => participant.userId),
      ])]
      const notificationCandidateIds = [...new Set([
        ...followerIds,
        ...participants
          .filter((participant) => participant.role === 'OBSERVER')
          .map((participant) => participant.userId),
        ...(replyTarget?.authorId ? [replyTarget.authorId] : []),
      ])].filter((userId) => userId !== principal.userId)
      const eligibleRecipients = notificationCandidateIds.length
        ? await tx.user.findMany({
            where: {
              id: { in: notificationCandidateIds },
              status: 'ACTIVE',
              companyAccess: {
                some: { companyId: task.companyId, status: 'ACTIVE' },
              },
              ...(task.groupId
                ? {
                    groupMemberships: {
                      some: { groupId: task.groupId, leftAt: null },
                    },
                  }
                : {}),
              OR: [
                { id: { in: directUserIds } },
                {
                  roles: {
                    some: {
                      status: 'ACTIVE',
                      validFrom: { lte: now },
                      OR: [{ validTo: null }, { validTo: { gt: now } }],
                      role: {
                        status: 'ACTIVE',
                        permissions: {
                          some: { permissionCode: 'tasks.manage' },
                        },
                      },
                    },
                  },
                },
              ],
            },
            select: { id: true },
          })
        : []
      const recipients = eligibleRecipients.map((recipient) => recipient.id)
      for (const recipientId of recipients) {
        await tx.notification.upsert({
          where: {
            dedupeKey: `task-comment:${commentId}:${recipientId}`,
          },
          create: {
            id: id('ntf'),
            recipientId,
            category: 'TASKS',
            safeTitle: 'Новий коментар до завдання',
            safeSnippet: task.title.slice(0, 180),
            entityType: 'TASK',
            entityId: task.id,
            deliveredAt: now,
            dedupeKey: `task-comment:${commentId}:${recipientId}`,
          },
          update: {},
        })
      }
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          companyId: task.companyId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'task.comment_created',
          entityType: 'TASK',
          entityId: task.id,
          result: 'SUCCESS',
          risk: 'NORMAL',
          correlationId: id('corr'),
          safeDiffJson: JSON.stringify({
            reply: Boolean(replyToCommentId),
            attachmentCount: attachmentIds.length,
          }),
        },
      })
      await tx.outboxEvent.create({
        data: {
          id: id('out'),
          aggregateType: 'TASK',
          aggregateId: task.id,
          aggregateVersion: updated.version,
          eventType: 'task.comment_created',
          safePayload: JSON.stringify({
            taskId: task.id,
            companyId: task.companyId,
            commentId: comment.id,
            reply: Boolean(replyToCommentId),
            attachmentCount: attachmentIds.length,
          }),
        },
      })
      return comment
    })
  }

  async addChecklistItem(principal: AuthPrincipal, taskId: string, textInput: string) {
    const task = await this.editableTask(principal, taskId)
    const text = textInput.trim()
    if (!text || text.length > 240) throw badRequest('checklist_text')
    const last = await this.prisma.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    const item = await this.prisma.taskChecklistItem.create({
      data: { id: id('chk'), taskId, position: (last?.position ?? 0) + 1, text },
    })
    await this.audit.record(principal, {
      action: 'task.checklist_added',
      entityType: 'TASK',
      entityId: taskId,
      companyId: task.companyId,
      safeDiff: { itemId: item.id },
    })
    return item
  }

  async updateChecklistItem(
    principal: AuthPrincipal,
    taskId: string,
    itemId: string,
    input: { isDone: boolean; expectedVersion: number },
  ) {
    const task = await this.editableTask(principal, taskId)
    const item = await this.prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } })
    if (!item) throw notFound()
    if (item.version !== input.expectedVersion) throw conflict()
    const result = await this.prisma.taskChecklistItem.updateMany({
      where: { id: item.id, version: input.expectedVersion },
      data: {
        isDone: input.isDone,
        completedById: input.isDone ? principal.userId : null,
        completedAt: input.isDone ? new Date() : null,
        version: { increment: 1 },
      },
    })
    if (!result.count) throw conflict()
    await this.audit.record(principal, {
      action: 'task.checklist_changed',
      entityType: 'TASK',
      entityId: taskId,
      companyId: task.companyId,
      safeDiff: { itemId, isDone: input.isDone },
    })
    return { id: item.id, isDone: input.isDone, version: input.expectedVersion + 1 }
  }

  async scheduleRecurrence(
    principal: AuthPrincipal,
    taskId: string,
    input: {
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
      interval: number
      firstOccurrenceAt: string
      until?: string
    },
  ) {
    const task = await this.editableTask(principal, taskId)
    if (
      !['DAILY', 'WEEKLY', 'MONTHLY'].includes(input.frequency)
      || !Number.isInteger(input.interval)
      || input.interval < 1
      || input.interval > 365
    ) {
      throw badRequest('task_recurrence')
    }
    const firstOccurrenceAt = new Date(input.firstOccurrenceAt)
    const until = input.until ? new Date(input.until) : undefined
    if (
      Number.isNaN(firstOccurrenceAt.getTime())
      || firstOccurrenceAt <= new Date()
      || (until && (Number.isNaN(until.getTime()) || until < firstOccurrenceAt))
    ) {
      throw badRequest('task_recurrence_dates')
    }
    const seriesKey = task.recurrenceKey ?? `series:${task.id}`
    if (!task.recurrenceKey) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { recurrenceKey: seriesKey },
      })
    }
    const occurrenceKey = `${seriesKey}:${firstOccurrenceAt.toISOString()}`
    const jobId = await this.jobs.enqueue(
      'task.recurrence',
      'TASK',
      task.id,
      {
        seriesKey,
        frequency: input.frequency,
        interval: input.interval,
        occurrenceAt: firstOccurrenceAt.toISOString(),
        until: until?.toISOString() ?? '',
      },
      `recurrence:${occurrenceKey}`,
      firstOccurrenceAt,
    )
    await this.audit.record(principal, {
      action: 'task.recurrence_scheduled',
      entityType: 'TASK',
      entityId: task.id,
      companyId: task.companyId,
      safeDiff: {
        frequency: input.frequency,
        interval: input.interval,
        firstOccurrenceAt: firstOccurrenceAt.toISOString(),
        until: until?.toISOString(),
      },
    })
    return { jobId, seriesKey, nextOccurrenceAt: firstOccurrenceAt.toISOString() }
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
      principal.permissions.has('messages.read') && messageIds.length
        ? this.prisma.message.findMany({
            where: {
              id: { in: messageIds },
              thread: {
                workspaceId: principal.workspaceId,
                OR: [
                  { companyId: null },
                  { companyId: task.companyId },
                ],
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
      principal.permissions.has('employees.read') && lifecycleIds.length
        ? this.prisma.lifecycleProcess.findMany({
            where: {
              id: { in: lifecycleIds },
              workspaceId: principal.workspaceId,
              companyId: task.companyId,
            },
            select: { id: true, processType: true },
          })
        : [],
      principal.permissions.has('documents.read') && documentIds.length
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
              kind: 'MESSAGE' as const,
              label: message.thread.title
                ? `Чат · ${message.thread.title}`
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
          kind: 'LIFECYCLE' as const,
          label: offboarding ? 'Процес офбордингу' : 'Процес онбордингу',
          href: `/${offboarding ? 'offboarding' : 'onboarding'}/${encodeURIComponent(process.id)}?company=${encodeURIComponent(task.companyId)}`,
          createdAt: link.createdAt.toISOString(),
        }]
      }
      if (type === 'DOCUMENT') {
        const document = documentsById.get(referenceId)
        return document
          ? [{
              id: link.id,
              kind: 'DOCUMENT' as const,
              label: `${document.number} · ${document.name}`,
              href: `/documents/${encodeURIComponent(document.id)}?company=${encodeURIComponent(task.companyId)}`,
              createdAt: link.createdAt.toISOString(),
            }]
          : []
      }
      return []
    })
  }

  private async normalizeTaskInput(
    companyId: string,
    input: {
      title: string
      description?: string
      assigneeId: string
      deadline?: string | null
      priority?: TaskPriorityValue
    },
    groupId: string | null = null,
  ): Promise<NormalizedTaskInput> {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (!title || title.length > 180) throw badRequest('task_title')
    if (description.length > 20_000) throw badRequest('task_description')
    if (!taskPriorities.includes(input.priority ?? 'MEDIUM')) {
      throw badRequest('task_priority')
    }
    const assignee = await this.prisma.user.findFirst({
      where: {
        id: input.assigneeId,
        companyAccess: { some: { companyId, status: 'ACTIVE' } },
        status: 'ACTIVE',
        ...(groupId
          ? { groupMemberships: { some: { groupId, leftAt: null } } }
          : {}),
      },
      select: { id: true },
    })
    if (!assignee) throw badRequest('task_assignee')
    const deadline = input.deadline ? new Date(input.deadline) : null
    if (deadline && Number.isNaN(deadline.getTime())) throw badRequest('task_deadline')
    return {
      title,
      description,
      assigneeId: assignee.id,
      deadline,
      priority: input.priority ?? 'MEDIUM',
    }
  }

  private async normalizeTaskRelated(
    principal: AuthPrincipal,
    companyId: string,
    input: CreateTaskInput['related'],
  ): Promise<{ type: 'MESSAGE'; id: string } | null> {
    if (input === undefined) return null
    const messageId = typeof input.id === 'string' ? input.id.trim() : ''
    if (
      input.type !== 'MESSAGE'
      || !messageId
      || messageId.length > 120
      || !principal.permissions.has('messages.read')
    ) {
      throw badRequest('task_related')
    }
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        thread: {
          workspaceId: principal.workspaceId,
          OR: [
            { companyId: null },
            { companyId },
          ],
          participants: {
            some: {
              userId: principal.userId,
              leftAt: null,
            },
          },
        },
      },
      select: { id: true },
    })
    if (!message) throw badRequest('task_related')
    return { type: 'MESSAGE', id: message.id }
  }

  private assertParticipantInput(input: ChangeTaskParticipantInput): void {
    if (
      typeof input.userId !== 'string'
      || !input.userId.trim()
      || input.userId.length > 120
      || !taskParticipantRoles.includes(input.role)
    ) throw badRequest('task_participant')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest('task_version')
    }
  }

  private async idempotentTask(
    userId: string,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<{ id: string; number: string } | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    })
    if (existing && existing.requestFingerprint !== requestFingerprint) {
      throw conflict('Цей ключ повтору вже використано для іншого запиту.')
    }
    if (!existing?.resultId) return null
    return this.prisma.task.findUnique({
      where: { id: existing.resultId },
      select: { id: true, number: true },
    })
  }

  private async activeSubtaskIds(taskId: string): Promise<string[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        parentTaskId: taskId,
        archivedAt: null,
        status: { notIn: [...terminalSubtaskStatuses] },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => row.id)
  }

  private async readableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    return this.taskAccess.readableTask(principal, taskId)
  }

  private async editableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    const task = await this.readableTask(principal, taskId)
    if (!await this.canEditTask(principal, task)) throw notFound()
    return task
  }

  private async manageableTask(principal: AuthPrincipal, taskId: string): Promise<Task> {
    const task = await this.readableTask(principal, taskId)
    if (!this.canManageParticipants(principal, task)) throw notFound()
    return task
  }

  private async canEditTask(
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'creatorId' | 'assigneeId'>,
  ): Promise<boolean> {
    if (
      task.creatorId === principal.userId
      || task.assigneeId === principal.userId
      || principal.permissions.has('tasks.manage')
    ) return true
    return Boolean(await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId: principal.userId,
        role: 'CO_EXECUTOR',
        removedAt: null,
      },
      select: { id: true },
    }))
  }

  private canManageParticipants(
    principal: AuthPrincipal,
    task: Pick<Task, 'creatorId'>,
  ): boolean {
    return task.creatorId === principal.userId || principal.permissions.has('tasks.manage')
  }

  private canReassign(
    principal: AuthPrincipal,
    task: Pick<Task, 'creatorId'>,
  ): boolean {
    return task.creatorId === principal.userId || principal.permissions.has('tasks.manage')
  }

  private async assertFollowerTarget(
    principal: AuthPrincipal,
    task: Pick<Task, 'id' | 'creatorId' | 'assigneeId' | 'companyId' | 'groupId'>,
    userId: string,
  ): Promise<void> {
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 120) {
      throw badRequest('task_follower')
    }
    if (userId !== principal.userId && !principal.permissions.has('tasks.manage')) {
      throw forbidden()
    }
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        companyAccess: { some: { companyId: task.companyId, status: 'ACTIVE' } },
        ...(task.groupId
          ? { groupMemberships: { some: { groupId: task.groupId, leftAt: null } } }
          : {}),
      },
      select: {
        id: true,
        roles: {
          where: {
            status: 'ACTIVE',
            validFrom: { lte: new Date() },
            OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
          },
          select: {
            role: {
              select: {
                status: true,
                permissions: {
                  where: { permissionCode: 'tasks.manage' },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    })
    if (!user) throw badRequest('task_follower')
    if (
      userId === principal.userId
      || task.creatorId === userId
      || task.assigneeId === userId
    ) return
    const participant = await this.prisma.taskParticipant.findFirst({
      where: {
        taskId: task.id,
        userId,
        removedAt: null,
      },
      select: { id: true },
    })
    const targetCanManage = user.roles.some((assignment) => (
      assignment.role.status === 'ACTIVE'
      && assignment.role.permissions.length > 0
    ))
    if (!participant && !targetCanManage) throw badRequest('task_follower_access')
  }

  private viewerRoles(
    userId: string,
    task: Pick<Task, 'creatorId' | 'assigneeId'>,
    participants: Array<{ userId: string; role: TaskParticipantRoleValue }>,
  ): Array<Exclude<TaskViewRole, 'ALL'>> {
    const roles: Array<Exclude<TaskViewRole, 'ALL'>> = []
    if (task.assigneeId === userId) roles.push('RESPONSIBLE')
    if (participants.some((participant) => (
      participant.userId === userId && participant.role === 'CO_EXECUTOR'
    ))) roles.push('CO_EXECUTOR')
    if (task.creatorId === userId) roles.push('CREATOR')
    if (participants.some((participant) => (
      participant.userId === userId && participant.role === 'OBSERVER'
    ))) roles.push('OBSERVER')
    return roles
  }

  private async mapRows(rows: TaskWithParent[], viewerId: string): Promise<TaskListItem[]> {
    const ids = rows.map((row) => row.id)
    const [assignees, counts, attachmentLinks, children, participants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.assigneeId))] } },
        select: { id: true, displayName: true, avatarAsset: true },
      }),
      ids.length
        ? this.prisma.comment.groupBy({
            by: ['entityId'],
            where: { entityType: 'TASK', entityId: { in: ids }, deletedAt: null },
            _count: { id: true },
          })
        : [],
      ids.length
        ? this.prisma.fileLink.findMany({
            where: {
              entityType: 'TASK',
              entityId: { in: ids },
              purpose: 'ATTACHMENT',
            },
            select: { entityId: true },
          })
        : [],
      ids.length
        ? this.prisma.task.findMany({
            where: { parentTaskId: { in: ids }, archivedAt: null },
            select: { parentTaskId: true, status: true },
          })
        : [],
      ids.length
        ? this.prisma.taskParticipant.findMany({
            where: { taskId: { in: ids }, userId: viewerId, removedAt: null },
            select: { taskId: true, userId: true, role: true },
          })
        : [],
    ])
    const byId = new Map(assignees.map((user) => [user.id, user]))
    const commentCount = new Map(counts.map((entry) => [entry.entityId, entry._count.id]))
    const attachmentCount = new Map<string, number>()
    for (const link of attachmentLinks) {
      attachmentCount.set(link.entityId, (attachmentCount.get(link.entityId) ?? 0) + 1)
    }
    const progress = new Map<string, { done: number; total: number }>()
    const participantsByTask = new Map<string, Array<{
      userId: string
      role: TaskParticipantRoleValue
    }>>()
    for (const participant of participants) {
      const current = participantsByTask.get(participant.taskId) ?? []
      current.push({
        userId: participant.userId,
        role: participant.role,
      })
      participantsByTask.set(participant.taskId, current)
    }
    for (const child of children) {
      if (!child.parentTaskId) continue
      const current = progress.get(child.parentTaskId) ?? { done: 0, total: 0 }
      current.total += 1
      if (this.isTerminalSubtask(child.status)) current.done += 1
      progress.set(child.parentTaskId, current)
    }
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      companyId: row.companyId,
      parentTaskId: row.parentTaskId,
      title: row.title,
      assignee: byId.get(row.assigneeId) ?? {
        id: row.assigneeId,
        displayName: 'Недоступний користувач',
        avatarAsset: null,
      },
      status: row.status,
      priority: row.priority,
      deadline: row.deadline?.toISOString() ?? null,
      version: row.version,
      commentCount: commentCount.get(row.id) ?? 0,
      attachmentCount: attachmentCount.get(row.id) ?? 0,
      subtaskProgress: progress.get(row.id) ?? { done: 0, total: 0 },
      viewerRoles: this.viewerRoles(viewerId, row, participantsByTask.get(row.id) ?? []),
    }))
  }

  private async normalizeParticipantIds(
    companyId: string,
    groupId: string | null,
    coExecutorIdsInput: string[] | undefined,
    observerIdsInput: string[] | undefined,
  ): Promise<{ coExecutorIds: string[]; observerIds: string[] }> {
    const normalize = (values: string[] | undefined) => {
      if (values === undefined) return []
      if (!Array.isArray(values) || values.length > 100) throw badRequest('task_participants')
      const ids = values.map((value) => typeof value === 'string' ? value.trim() : '')
      if (ids.some((value) => !value || value.length > 120)) throw badRequest('task_participants')
      return [...new Set(ids)].sort()
    }
    const coExecutorIds = normalize(coExecutorIdsInput)
    const observerIds = normalize(observerIdsInput)
    const userIds = [...new Set([...coExecutorIds, ...observerIds])]
    if (!userIds.length) return { coExecutorIds, observerIds }
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        status: 'ACTIVE',
        companyAccess: { some: { companyId, status: 'ACTIVE' } },
        ...(groupId
          ? { groupMemberships: { some: { groupId, leftAt: null } } }
          : {}),
      },
      select: { id: true },
    })
    if (users.length !== userIds.length) throw badRequest('task_participants')
    return { coExecutorIds, observerIds }
  }

  private taskFingerprint(purpose: string, value: unknown): string {
    return fingerprint(JSON.stringify(value), purpose)
  }

  private taskActivityLabel(action: string, safeDiffJson: string): string {
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
    if (action === 'task.status_changed') {
      const status = typeof diff.status === 'object' && diff.status
        ? (diff.status as Record<string, unknown>).to
        : null
      const labels: Record<string, string> = {
        NEW: '«Нове»',
        PLANNED: '«Заплановано»',
        IN_PROGRESS: '«В роботі»',
        IN_REVIEW: '«На перевірці»',
        DONE: '«Виконано»',
        BLOCKED: '«Заблоковано»',
        CANCELLED: '«Скасовано»',
        ARCHIVED: '«Архів»',
      }
      return typeof status === 'string'
        ? `Статус змінено на ${labels[status] ?? status}`
        : 'Змінено статус'
    }
    if (action === 'task.participant_added') return 'Додано учасника'
    if (action === 'task.participant_removed') return 'Вилучено учасника'
    if (action === 'task.attachment_added') return 'Додано файл'
    if (action === 'task.attachment_removed') return 'Вилучено файл із завдання'
    if (action === 'task.comment_created') {
      return diff.reply ? 'Додано відповідь в обговоренні' : 'Додано коментар'
    }
    if (action === 'task.subtask_created') return 'Створено підзадачу'
    if (action === 'task.checklist_added') return 'Додано крок до списку'
    if (action === 'task.checklist_changed') return 'Оновлено контрольний список'
    if (action === 'task.recurrence_scheduled') return 'Заплановано повторення'
    return 'Оновлено завдання'
  }

  private taskReference(
    task: { id: string; number: string; title: string; status: TaskStatusValue },
  ): TaskReference {
    return {
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
    }
  }

  private isTerminalSubtask(status: string): boolean {
    return terminalSubtaskStatuses.includes(status as typeof terminalSubtaskStatuses[number])
  }

  private taskNumber(): string {
    return `TSK-${Date.now().toString(36).toUpperCase()}-${id('n').slice(-4).toUpperCase()}`
  }
}
