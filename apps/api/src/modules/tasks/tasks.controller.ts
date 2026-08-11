import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import {
  createTaskSchema,
  manualTimeEntrySchema,
  mentionSearchQuerySchema,
  taskCommentInputSchema,
  taskParticipantRoleV2Schema,
  taskRecurrenceInputSchema,
  taskReminderInputSchema,
  taskRelationInputSchema,
  updateTimeEntrySchema,
  updateTaskSchema,
} from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import type { UploadedBinary } from '../files/files.service.js'
import { TaskCatalogService } from './task-catalog.service.js'
import { TaskAttachmentsService } from './task-attachments.service.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskParticipantsService } from './task-participants.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskRecurrenceService } from './task-recurrence.service.js'
import { TaskReminderService } from './task-reminder.service.js'
import { TaskTimeService } from './task-time.service.js'
import {
  TasksService,
  type CreateSubtaskInput,
  type LegacyUpdateTaskInput,
  type TaskFollowerInput,
  type TaskUserStateInput,
} from './tasks.service.js'

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly commands: TaskCommandService,
    private readonly catalog: TaskCatalogService,
    private readonly attachments: TaskAttachmentsService,
    private readonly participants: TaskParticipantsService,
    private readonly checklist: TaskChecklistService,
    private readonly relations: TaskRelationsService,
    private readonly reminders: TaskReminderService,
    private readonly recurrence: TaskRecurrenceService,
    private readonly time: TaskTimeService,
  ) {}

  @Get()
  list(@Req() request: BertRequest, @Query('company') company?: string, @Query('role') role?: string, @Query('segment') segment?: string, @Query('page') page?: string, @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string, @Query('favorite') favorite?: string, @Query('important') important?: string, @Query('overdue') overdue?: string, @Query('preset') preset?: string, @Query('dueFrom') dueFrom?: string, @Query('dueTo') dueTo?: string, @Query('groupId') groupId?: string, @Query('assigneeId') assigneeId?: string, @Query('creatorId') creatorId?: string, @Query('coExecutorId') coExecutorId?: string, @Query('observerId') observerId?: string) {
    const legacyRole = segment === 'created' ? 'CREATOR' : segment === 'all' ? 'ALL' : 'RESPONSIBLE'
    return this.tasks.list(principalFrom(request), company, role ?? legacyRole, Number(page ?? 1), 25, { search, status, priority, favorite, important, overdue, preset, dueFrom, dueTo, groupId, assigneeId, creatorId, coExecutorId, observerId })
  }

  @Get('options')
  options(
    @Req() request: BertRequest,
    @Query('groupId') groupId?: string,
    @Query('projectId') projectId?: string,
    @Query('search') search?: string,
  ) {
    return this.catalog.options(principalFrom(request), { groupId, projectId, search })
  }

  @Get('projects')
  projects(@Req() request: BertRequest, @Query('search') search?: string) {
    return this.catalog.projects(principalFrom(request), search)
  }

  @Post('projects')
  createProject(@Req() request: BertRequest, @Body() body: { name?: unknown }) {
    if (typeof body.name !== 'string') throw badRequest('task_project')
    return this.catalog.createProject(principalFrom(request), body.name)
  }

  @Get('tags')
  tags(@Req() request: BertRequest, @Query('search') search?: string) {
    return this.catalog.tags(principalFrom(request), search)
  }

  @Post('tags')
  createTag(
    @Req() request: BertRequest,
    @Body() body: { name?: unknown; color?: unknown },
  ) {
    if (
      typeof body.name !== 'string'
      || (body.color !== undefined && body.color !== null && typeof body.color !== 'string')
    ) {
      throw badRequest('task_tag')
    }
    return this.catalog.createTag(principalFrom(request), body.name, body.color)
  }

  @Post('attachments/staged')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 },
  }))
  stageAttachment(
    @Req() request: BertRequest,
    @UploadedFile() file: UploadedBinary,
  ) {
    return this.attachments.stage(principalFrom(request), file)
  }

  @Get(':id/activity')
  activity(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.tasks.activity(principalFrom(request), taskId, cursor)
  }

  @Get(':id/mention-candidates')
  mentionCandidates(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = mentionSearchQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('task_mention_query_invalid')
    return this.participants.mentionCandidates(principalFrom(request), taskId, parsed.data)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') taskId: string) {
    return this.tasks.detail(principalFrom(request), taskId)
  }

  @Patch(':id')
  update(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() rawBody: unknown,
  ) {
    if (isLegacyUpdateTaskInput(rawBody)) {
      return this.tasks.updateLegacy(principalFrom(request), taskId, rawBody)
    }
    const parsed = updateTaskSchema.safeParse(rawBody)
    if (parsed.success) {
      return this.commands.update(principalFrom(request), taskId, parsed.data)
    }
    throw badRequest('task_invalid')
  }

  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 },
  }))
  uploadAttachment(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @UploadedFile() file: UploadedBinary,
  ) {
    return this.tasks.uploadAttachment(principalFrom(request), taskId, file)
  }

  @Delete(':id/attachments/:fileId')
  removeAttachment(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.tasks.removeAttachment(principalFrom(request), taskId, fileId)
  }

  @Post()
  create(
    @Req() request: BertRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    const parsed = createTaskSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('task_invalid')
    return this.commands.create(principalFrom(request), parsed.data, key)
  }

  @Post(':id/subtasks')
  createSubtask(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: CreateSubtaskInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.createSubtask(principalFrom(request), taskId, body, key)
  }

  @Put(':id/participants/:userId')
  putParticipant(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('userId') userId: string,
    @Body() body: { role?: unknown; expectedVersion?: unknown },
  ) {
    const role = taskParticipantRoleV2Schema.safeParse(body.role)
    if (
      !role.success
      || typeof body.expectedVersion !== 'number'
      || !Number.isInteger(body.expectedVersion)
    ) {
      throw badRequest('task_participant')
    }
    return this.participants.put(
      principalFrom(request),
      taskId,
      userId,
      role.data,
      body.expectedVersion,
    )
  }

  @Delete(':id/participants/:userId')
  removeParticipant(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('userId') userId: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.participants.remove(
      principalFrom(request),
      taskId,
      userId,
      body.expectedVersion,
    )
  }

  @Post(':id/followers')
  follow(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: TaskFollowerInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.followTask(principalFrom(request), taskId, body, key)
  }

  @Delete(':id/followers/:userId')
  unfollow(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('userId') userId: string,
  ) {
    return this.tasks.unfollowTask(principalFrom(request), taskId, userId)
  }

  @Put(':id/user-state')
  userState(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: TaskUserStateInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.setUserState(principalFrom(request), taskId, body, key)
  }

  @Post(':id/reminders')
  createReminder(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { reminder?: unknown; expectedVersion?: unknown },
  ) {
    const reminder = taskReminderInputSchema.safeParse(body.reminder)
    if (
      !reminder.success
      || typeof body.expectedVersion !== 'number'
      || !Number.isInteger(body.expectedVersion)
    ) {
      throw badRequest('task_reminder')
    }
    return this.reminders.add(
      principalFrom(request),
      taskId,
      reminder.data,
      body.expectedVersion,
    )
  }

  @Delete(':id/reminders/:reminderId')
  cancelReminder(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.reminders.cancel(principalFrom(request), taskId, reminderId)
  }

  @Patch(':id/status')
  changeStatus(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { status: string; expectedVersion: number }) {
    return this.tasks.changeStatus(principalFrom(request), taskId, body.status, body.expectedVersion)
  }

  @Post(':id/comments')
  comment(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = taskCommentInputSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('task_comment_invalid')
    if (parsed.data.mentions.length && !key) throw badRequest('idempotency_key_required')
    return this.tasks.addComment(principalFrom(request), taskId, parsed.data, key)
  }

  @Post(':id/checklist')
  checklistItem(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { title: string; expectedVersion: number },
  ) {
    return this.checklist.add(
      principalFrom(request),
      taskId,
      body.title,
      body.expectedVersion,
    )
  }

  @Patch(':id/checklist/:itemId')
  checklistState(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('itemId') itemId: string,
    @Body() body: { title?: string; isCompleted?: boolean; expectedVersion: number },
  ) {
    return this.checklist.update(principalFrom(request), taskId, itemId, body)
  }

  @Delete(':id/checklist/:itemId')
  removeChecklistItem(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('itemId') itemId: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.checklist.remove(
      principalFrom(request),
      taskId,
      itemId,
      body.expectedVersion,
    )
  }

  @Put(':id/checklist-order')
  reorderChecklist(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { itemIds: string[]; expectedVersion: number },
  ) {
    return this.checklist.reorder(
      principalFrom(request),
      taskId,
      body.itemIds,
      body.expectedVersion,
    )
  }

  @Post(':id/relations')
  addRelation(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { relation?: unknown; expectedVersion?: unknown },
  ) {
    const relation = taskRelationInputSchema.safeParse(body.relation)
    if (
      !relation.success
      || typeof body.expectedVersion !== 'number'
      || !Number.isInteger(body.expectedVersion)
    ) {
      throw badRequest('task_relation')
    }
    return this.relations.add(
      principalFrom(request),
      taskId,
      relation.data,
      body.expectedVersion,
    )
  }

  @Delete(':id/relations/:relationId')
  removeRelation(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('relationId') relationId: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.relations.remove(
      principalFrom(request),
      taskId,
      relationId,
      body.expectedVersion,
    )
  }

  @Post(':id/archive')
  archive(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.commands.archive(principalFrom(request), taskId, body.expectedVersion)
  }

  @Put(':id/recurrence')
  setRecurrence(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { recurrence?: unknown; expectedVersion?: unknown },
  ) {
    const recurrence = taskRecurrenceInputSchema.safeParse(body.recurrence)
    if (
      !recurrence.success
      || typeof body.expectedVersion !== 'number'
      || !Number.isInteger(body.expectedVersion)
    ) {
      throw badRequest('task_recurrence')
    }
    return this.recurrence.update(
      principalFrom(request),
      taskId,
      recurrence.data,
      body.expectedVersion,
    )
  }

  @Delete(':id/recurrence')
  cancelRecurrence(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.recurrence.cancel(
      principalFrom(request),
      taskId,
      body.expectedVersion,
    )
  }

  @Get(':id/time-entries')
  timeEntries(@Req() request: BertRequest, @Param('id') taskId: string) {
    return this.time.list(principalFrom(request), taskId)
  }

  @Post(':id/time-entries')
  addTimeEntry(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = manualTimeEntrySchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('task_time')
    return this.time.addManual(principalFrom(request), taskId, parsed.data)
  }

  @Post(':id/timer/start')
  startTimer(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: { description?: string },
  ) {
    return this.time.start(principalFrom(request), taskId, body.description)
  }

  @Post(':id/timer/stop')
  stopTimer(@Req() request: BertRequest, @Param('id') taskId: string) {
    return this.time.stop(principalFrom(request), taskId)
  }

  @Patch(':id/time-entries/:entryId')
  updateTimeEntry(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('entryId') entryId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateTimeEntrySchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('task_time')
    return this.time.update(principalFrom(request), taskId, entryId, parsed.data)
  }

  @Delete(':id/time-entries/:entryId')
  removeTimeEntry(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.time.remove(principalFrom(request), taskId, entryId)
  }
}

function isLegacyUpdateTaskInput(value: unknown): value is LegacyUpdateTaskInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.title === 'string'
    && typeof input.assigneeId === 'string'
    && typeof input.priority === 'string'
    && typeof input.expectedVersion === 'number'
}
