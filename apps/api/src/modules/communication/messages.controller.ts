import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, Res, Sse, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import * as archiver from 'archiver'
import type { Response } from 'express'
import {
  addChatParticipantSchema,
  chatMentionCandidatesQuerySchema,
  chatMessagePageQuerySchema,
  chatMessageSearchQuerySchema,
  chatReactionSchema,
  chatThreadListQuerySchema,
  chatUserSearchQuerySchema,
  createChatThreadSchema,
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChatReadSchema,
  removeChatParticipantSchema,
  recommendedChatUsersQuerySchema,
  sendChatMessageSchema,
  updateChatParticipantSchema,
  updateChatPreferenceSchema,
} from '@lankadws/contracts'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest, notFound } from '../../common/errors.js'
import { getConfig } from '../../config/config.js'
import type { UploadedBinary } from '../files/files.service.js'
import { createCleanFileReadStream } from '../files/storage.js'
import { ChatRealtimeService } from './chat-realtime.service.js'
import { MessagesService } from './messages.service.js'

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  @Get('threads')
  threads(@Req() request: LankaDWSRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = chatThreadListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_query_invalid')
    return this.messages.threads(principalFrom(request), parsed.data)
  }

  @Get('summary')
  summary(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.messages.summary(principalFrom(request), company)
  }

  @Post('threads')
  createThread(
    @Req() request: LankaDWSRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = createChatThreadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_thread_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.create(principalFrom(request), parsed.data, key)
  }

  @Post('groups/:groupId/thread')
  groupThread(@Req() request: LankaDWSRequest, @Param('groupId') groupId: string) {
    return this.messages.groupThread(principalFrom(request), groupId)
  }

  @Get('threads/:id')
  detail(@Req() request: LankaDWSRequest, @Param('id') id: string) { return this.messages.detail(principalFrom(request), id) }

  @Get('threads/:id/mention-candidates')
  mentionCandidates(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = chatMentionCandidatesQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_mention_query_invalid')
    return this.messages.mentionCandidates(principalFrom(request), id, parsed.data)
  }

  @Get('threads/:id/messages')
  messagesPage(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = chatMessagePageQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_message_query_invalid')
    return this.messages.messagesPage(principalFrom(request), id, parsed.data)
  }

  @Get('threads/:id/messages/search')
  searchMessages(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = chatMessageSearchQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_message_search_invalid')
    return this.messages.searchMessages(principalFrom(request), id, parsed.data)
  }

  @Get('threads/:id/preview')
  preview(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.messages.preview(principalFrom(request), id)
  }

  @Sse('threads/:id/events')
  async events(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    const principal = principalFrom(request)
    if (!await this.realtime.canAccess(principal, id)) throw notFound()
    return this.realtime.stream(principal, id)
  }

  @Sse('events')
  globalEvents(@Req() request: LankaDWSRequest) {
    return this.realtime.userStream(principalFrom(request))
  }

  @Get('users/search')
  searchUsers(
    @Req() request: LankaDWSRequest,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = chatUserSearchQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_user_search_invalid')
    return this.messages.searchUsers(principalFrom(request), parsed.data)
  }

  @Get('users/recommended')
  recommendedUsers(
    @Req() request: LankaDWSRequest,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = recommendedChatUsersQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('chat_recommendations_query_invalid')
    return this.messages.recommendedUsers(principalFrom(request), parsed.data)
  }

  @Get('users/:id')
  user(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Query('company') company: string,
  ) {
    if (!company) throw badRequest('chat_company_required')
    return this.messages.user(principalFrom(request), company, id)
  }

  @Post('threads/:id/attachments')
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
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @UploadedFile() file: UploadedBinary,
  ) {
    return this.messages.uploadAttachment(principalFrom(request), id, file)
  }

  @Post('threads/:id/participants')
  addParticipant(
    @Req() request: LankaDWSRequest,
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
  updateParticipant(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateChatParticipantSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_participant_invalid')
    return this.messages.updateParticipant(principalFrom(request), id, userId, parsed.data)
  }

  @Delete('threads/:id/participants/:userId')
  removeParticipant(
    @Req() request: LankaDWSRequest,
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
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = markChatReadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_read_invalid')
    return this.messages.markRead(principalFrom(request), id, parsed.data)
  }

  @Put('threads/:id/preferences')
  updatePreference(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = updateChatPreferenceSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_preference_invalid')
    return this.messages.updatePreference(principalFrom(request), id, parsed.data)
  }

  @Post('threads/:id/messages')
  post(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = sendChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.post(principalFrom(request), id, parsed.data, key)
  }

  @Get(':id/attachments/archive')
  async archiveAttachments(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const archiveData = await this.messages.archiveAttachments(principalFrom(request), id)
    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archiveData.archiveName)}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const zip = new archiver.ZipArchive({ zlib: { level: 6 } })
    zip.on('error', () => response.destroy())
    zip.pipe(response)
    for (const file of archiveData.files) zip.append(createCleanFileReadStream(file.storageKey), { name: file.fileName })
    await zip.finalize()
  }

  @Get(':id')
  message(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.messages.message(principalFrom(request), id)
  }

  @Patch(':id')
  editMessage(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = editChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    return this.messages.editMessage(principalFrom(request), id, parsed.data)
  }

  @Delete(':id')
  deleteMessage(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = deleteChatMessageSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('chat_message_invalid')
    return this.messages.deleteMessage(principalFrom(request), id, parsed.data)
  }

  @Post(':id/reactions')
  addReaction(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = chatReactionSchema.safeParse(rawBody ?? {})
    if (!parsed.success) throw badRequest('chat_reaction_invalid')
    return this.messages.react(principalFrom(request), id, true)
  }

  @Delete(':id/reactions')
  removeReaction(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = chatReactionSchema.safeParse(rawBody ?? {})
    if (!parsed.success) throw badRequest('chat_reaction_invalid')
    return this.messages.react(principalFrom(request), id, false)
  }

}
