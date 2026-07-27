import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, Sse, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import {
  addChatParticipantSchema,
  chatThreadListQuerySchema,
  convertChatMessageToEventSchema,
  convertChatMessageToTaskSchema,
  createChatThreadSchema,
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChatReadSchema,
  Permission,
  removeChatParticipantSchema,
  sendChatMessageSchema,
  updateChatParticipantSchema,
  updateChatPreferenceSchema,
} from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { CalendarService } from '../calendar/calendar.service.js'
import type { UploadedBinary } from '../files/files.service.js'
import { ChatRealtimeService } from './chat-realtime.service.js'
import { MessagesService } from './messages.service.js'

@Controller('messages')
@RequirePermissions(Permission.MessagesRead)
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly calendar: CalendarService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  @Get('threads')
  threads(@Req() request: BertRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = chatThreadListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_query_invalid')
    return this.messages.threads(principalFrom(request), parsed.data)
  }

  @Get('summary')
  summary(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.messages.summary(principalFrom(request), company)
  }

  @Post('threads')
  @RequirePermissions(Permission.MessagesWrite)
  createThread(
    @Req() request: BertRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = createChatThreadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_thread_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.create(principalFrom(request), parsed.data, key)
  }

  @Post('groups/:groupId/thread')
  @RequirePermissions(Permission.MessagesWrite)
  groupThread(@Req() request: BertRequest, @Param('groupId') groupId: string) {
    return this.messages.groupThread(principalFrom(request), groupId)
  }

  @Get('threads/:id')
  detail(@Req() request: BertRequest, @Param('id') id: string) { return this.messages.detail(principalFrom(request), id) }

  @Sse('threads/:id/events')
  async events(@Req() request: BertRequest, @Param('id') id: string) {
    const principal = principalFrom(request)
    if (!await this.realtime.canAccess(principal, id)) throw notFound()
    return this.realtime.stream(principal, id)
  }

  @Post('threads/:id/attachments')
  @RequirePermissions(Permission.MessagesWrite)
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  uploadAttachment(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @UploadedFile() file: UploadedBinary,
  ) {
    return this.messages.uploadAttachment(principalFrom(request), id, file)
  }

  @Post('threads/:id/participants')
  @RequirePermissions(Permission.MessagesWrite)
  addParticipant(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = addChatParticipantSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_participant_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.addParticipant(principalFrom(request), id, parsed.data, key)
  }

  @Put('threads/:id/participants/:userId')
  @RequirePermissions(Permission.MessagesWrite)
  updateParticipant(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateChatParticipantSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_participant_invalid')
    return this.messages.updateParticipant(principalFrom(request), id, userId, parsed.data)
  }

  @Delete('threads/:id/participants/:userId')
  @RequirePermissions(Permission.MessagesWrite)
  removeParticipant(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = removeChatParticipantSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_participant_invalid')
    return this.messages.removeParticipant(principalFrom(request), id, userId, parsed.data)
  }

  @Post('threads/:id/read')
  markRead(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = markChatReadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_read_invalid')
    return this.messages.markRead(principalFrom(request), id, parsed.data)
  }

  @Put('threads/:id/preferences')
  updatePreference(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateChatPreferenceSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_preference_invalid')
    return this.messages.updatePreference(principalFrom(request), id, parsed.data)
  }

  @Post('threads/:id/messages')
  @RequirePermissions(Permission.MessagesWrite)
  post(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = sendChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.post(principalFrom(request), id, parsed.data, key)
  }

  @Patch(':id')
  @RequirePermissions(Permission.MessagesWrite)
  editMessage(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = editChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    return this.messages.editMessage(principalFrom(request), id, parsed.data)
  }

  @Delete(':id')
  @RequirePermissions(Permission.MessagesWrite)
  deleteMessage(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = deleteChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    return this.messages.deleteMessage(principalFrom(request), id, parsed.data)
  }

  @Post(':id/task')
  @RequirePermissions(Permission.TasksCreate)
  createTask(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = convertChatMessageToTaskSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_task_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.createTask(principalFrom(request), id, parsed.data, key)
  }

  @Post(':id/event')
  @RequirePermissions(Permission.CalendarManage)
  createEvent(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = convertChatMessageToEventSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_event_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.calendar.createFromMessage(principalFrom(request), id, parsed.data, key)
  }
}
