import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  acknowledgeFeedPostSchema,
  createFeedCommentSchema,
  createFeedPostSchema,
  feedMentionCandidatesQuerySchema,
  feedListQuerySchema,
  mentionSearchQuerySchema,
  markFeedReadSchema,
  shareFileToFeedSchema,
  updateFeedPostSchema,
} from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import type { UploadedBinary } from '../files/files.service.js'
import { FeedService } from './feed.service.js'

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@Req() request: LankaDWSRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = feedListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('feed_query_invalid')
    return this.feed.list(principalFrom(request), parsed.data)
  }

  @Get('summary')
  summary(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.feed.summary(principalFrom(request), company)
  }

  @Get('audiences')
  audiences(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.feed.audiences(principalFrom(request), company)
  }

  @Get('authors')
  authors(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.feed.authors(principalFrom(request), company)
  }

  @Get('facets/audiences')
  audienceFacets(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.feed.audienceFacets(principalFrom(request), company)
  }

  @Get('mention-candidates')
  mentionCandidates(@Req() request: LankaDWSRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = feedMentionCandidatesQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('feed_mention_query_invalid')
    return this.feed.mentionCandidates(principalFrom(request), parsed.data)
  }

  @Get(':id/mention-candidates')
  postMentionCandidates(
    @Req() request: LankaDWSRequest,
    @Param('id') postId: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parsed = mentionSearchQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('feed_mention_query_invalid')
    return this.feed.postMentionCandidates(principalFrom(request), postId, parsed.data)
  }

  @Post('read')
  markRead(@Req() request: LankaDWSRequest, @Body() rawBody: unknown) {
    const parsed = markFeedReadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_read_invalid')
    return this.feed.markRead(principalFrom(request), parsed.data)
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  uploadAttachment(
    @Req() request: LankaDWSRequest,
    @Query('company') companyId: string | undefined,
    @UploadedFile() file: UploadedBinary,
  ) {
    if (!companyId) throw badRequest('company_required')
    return this.feed.uploadAttachment(principalFrom(request), companyId, file)
  }

  @Post('file-shares/:fileId')
  shareFile(
    @Req() request: LankaDWSRequest,
    @Param('fileId') fileId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parsed = shareFileToFeedSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_file_share_invalid')
    if (!idempotencyKey) throw badRequest('idempotency_key_required')
    return this.feed.shareFile(principalFrom(request), fileId, parsed.data, idempotencyKey)
  }

  @Delete('file-shares/:shareId')
  revokeFileShare(
    @Req() request: LankaDWSRequest,
    @Param('shareId') shareId: string,
    @Body() body: { expectedVersion?: number },
  ) {
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      throw badRequest('feed_version_invalid')
    }
    return this.feed.revokeFileShare(principalFrom(request), shareId, Number(body.expectedVersion))
  }

  @Post()
  create(
    @Req() request: LankaDWSRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parsed = createFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_post_invalid')
    if (!idempotencyKey) throw badRequest('idempotency_key_required')
    return this.feed.create(principalFrom(request), parsed.data, idempotencyKey)
  }

  @Get(':id')
  detail(@Req() request: LankaDWSRequest, @Param('id') postId: string) {
    return this.feed.detail(principalFrom(request), postId)
  }

  @Patch(':id')
  update(@Req() request: LankaDWSRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = updateFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_post_invalid')
    return this.feed.update(principalFrom(request), postId, parsed.data)
  }

  @Delete(':id')
  archive(
    @Req() request: LankaDWSRequest,
    @Param('id') postId: string,
    @Body() body: { expectedVersion?: number },
  ) {
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      throw badRequest('feed_version_invalid')
    }
    return this.feed.archive(principalFrom(request), postId, Number(body.expectedVersion))
  }

  @Post(':id/comments')
  comment(@Req() request: LankaDWSRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = createFeedCommentSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_comment_invalid')
    return this.feed.comment(principalFrom(request), postId, parsed.data)
  }

  @Post(':id/reactions/like')
  like(@Req() request: LankaDWSRequest, @Param('id') postId: string) {
    return this.feed.toggleLike(principalFrom(request), postId)
  }

  @Post(':id/acknowledge')
  acknowledge(@Req() request: LankaDWSRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = acknowledgeFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_acknowledgement_invalid')
    return this.feed.acknowledge(principalFrom(request), postId, parsed.data.acknowledgementVersion)
  }
}
