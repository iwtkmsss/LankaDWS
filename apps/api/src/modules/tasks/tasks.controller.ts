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
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import type { UploadedBinary } from '../files/files.service.js'
import {
  TasksService,
  type ChangeTaskParticipantInput,
  type CreateSubtaskInput,
  type CreateTaskInput,
  type TaskCommentInput,
  type TaskFollowerInput,
  type TaskReminderInput,
  type TaskUserStateInput,
  type UpdateTaskInput,
} from './tasks.service.js'

@Controller('tasks')
@RequirePermissions(Permission.TasksRead)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() request: BertRequest, @Query('company') company?: string, @Query('role') role?: string, @Query('segment') segment?: string, @Query('page') page?: string, @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string, @Query('favorite') favorite?: string, @Query('important') important?: string, @Query('overdue') overdue?: string, @Query('preset') preset?: string, @Query('dueFrom') dueFrom?: string, @Query('dueTo') dueTo?: string, @Query('groupId') groupId?: string, @Query('assigneeId') assigneeId?: string, @Query('creatorId') creatorId?: string, @Query('coExecutorId') coExecutorId?: string, @Query('observerId') observerId?: string) {
    const legacyRole = segment === 'created' ? 'CREATOR' : segment === 'all' ? 'ALL' : 'RESPONSIBLE'
    return this.tasks.list(principalFrom(request), company, role ?? legacyRole, Number(page ?? 1), 25, { search, status, priority, favorite, important, overdue, preset, dueFrom, dueTo, groupId, assigneeId, creatorId, coExecutorId, observerId })
  }

  @Get(':id/activity')
  activity(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.tasks.activity(principalFrom(request), taskId, cursor)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') taskId: string) {
    return this.tasks.detail(principalFrom(request), taskId)
  }

  @Patch(':id')
  update(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: UpdateTaskInput,
  ) {
    return this.tasks.updateTask(principalFrom(request), taskId, body)
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
  @RequirePermissions(Permission.TasksCreate)
  create(@Req() request: BertRequest, @Body() body: CreateTaskInput, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.create(principalFrom(request), body, key)
  }

  @Post(':id/subtasks')
  @RequirePermissions(Permission.TasksCreate)
  createSubtask(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: CreateSubtaskInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.createSubtask(principalFrom(request), taskId, body, key)
  }

  @Post(':id/participants')
  addParticipant(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Body() body: ChangeTaskParticipantInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.addParticipant(principalFrom(request), taskId, body, key)
  }

  @Delete(':id/participants/:userId/:role')
  removeParticipant(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('userId') userId: string,
    @Param('role') role: string,
    @Body() body: { expectedVersion: number },
  ) {
    return this.tasks.removeParticipant(
      principalFrom(request),
      taskId,
      userId,
      role,
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
    @Body() body: TaskReminderInput,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.createReminder(principalFrom(request), taskId, body, key)
  }

  @Delete(':id/reminders/:reminderId')
  cancelReminder(
    @Req() request: BertRequest,
    @Param('id') taskId: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.tasks.cancelReminder(principalFrom(request), taskId, reminderId)
  }

  @Patch(':id/status')
  changeStatus(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { status: string; expectedVersion: number }) {
    return this.tasks.changeStatus(principalFrom(request), taskId, body.status, body.expectedVersion)
  }

  @Post(':id/comments')
  comment(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: TaskCommentInput) {
    return this.tasks.addComment(principalFrom(request), taskId, body)
  }

  @Post(':id/checklist')
  checklistItem(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { text: string }) {
    return this.tasks.addChecklistItem(principalFrom(request), taskId, body.text)
  }

  @Patch(':id/checklist/:itemId')
  checklistState(@Req() request: BertRequest, @Param('id') taskId: string, @Param('itemId') itemId: string, @Body() body: { isDone: boolean; expectedVersion: number }) {
    return this.tasks.updateChecklistItem(principalFrom(request), taskId, itemId, body)
  }

  @Post(':id/recurrence')
  recurrence(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; firstOccurrenceAt: string; until?: string }) {
    return this.tasks.scheduleRecurrence(principalFrom(request), taskId, body)
  }
}
