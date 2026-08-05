import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  acknowledgeFeedPostSchema,
  createFeedCommentSchema,
  createFeedPostSchema,
  feedListQuerySchema,
  markFeedReadSchema,
  shareFileToFeedSchema,
  updateFeedSubscriptionSchema,
  updateFeedPostSchema,
} from '@bert-crm/contracts'
import { badRequest } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import type { UploadedBinary } from '../files/files.service.js'
import { FeedService } from './feed.service.js'

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@Req() request: BertRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = feedListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('feed_query_invalid')
    return this.feed.list(principalFrom(request), parsed.data)
  }

  @Get('audiences')
  audiences(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.feed.audiences(principalFrom(request), company)
  }

  @Get('authors')
  authors(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.feed.authors(principalFrom(request), company)
  }

  @Get('facets/audiences')
  audienceFacets(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.feed.audienceFacets(principalFrom(request), company)
  }

  @Post('read')
  markRead(@Req() request: BertRequest, @Body() rawBody: unknown) {
    const parsed = markFeedReadSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_read_invalid')
    return this.feed.markRead(principalFrom(request), parsed.data)
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  uploadAttachment(
    @Req() request: BertRequest,
    @Query('company') companyId: string | undefined,
    @UploadedFile() file: UploadedBinary,
  ) {
    if (!companyId) throw badRequest('company_required')
    return this.feed.uploadAttachment(principalFrom(request), companyId, file)
  }

  @Post('file-shares/:fileId')
  shareFile(
    @Req() request: BertRequest,
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
    @Req() request: BertRequest,
    @Param('shareId') shareId: string,
    @Body() body: { expectedVersion?: number },
  ) {
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      throw badRequest('feed_version_invalid')
    }
    return this.feed.revokeFileShare(principalFrom(request), shareId, Number(body.expectedVersion))
  }

  @Put('items/:itemId/favorite')
  favorite(@Req() request: BertRequest, @Param('itemId') itemId: string) {
    return this.feed.setFavorite(principalFrom(request), itemId, true)
  }

  @Delete('items/:itemId/favorite')
  unfavorite(@Req() request: BertRequest, @Param('itemId') itemId: string) {
    return this.feed.setFavorite(principalFrom(request), itemId, false)
  }

  @Post()
  create(
    @Req() request: BertRequest,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parsed = createFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_post_invalid')
    if (!idempotencyKey) throw badRequest('idempotency_key_required')
    return this.feed.create(principalFrom(request), parsed.data, idempotencyKey)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') postId: string) {
    return this.feed.detail(principalFrom(request), postId)
  }

  @Patch(':id')
  update(@Req() request: BertRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = updateFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_post_invalid')
    return this.feed.update(principalFrom(request), postId, parsed.data)
  }

  @Delete(':id')
  archive(
    @Req() request: BertRequest,
    @Param('id') postId: string,
    @Body() body: { expectedVersion?: number },
  ) {
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      throw badRequest('feed_version_invalid')
    }
    return this.feed.archive(principalFrom(request), postId, Number(body.expectedVersion))
  }

  @Post(':id/comments')
  comment(@Req() request: BertRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = createFeedCommentSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_comment_invalid')
    return this.feed.comment(principalFrom(request), postId, parsed.data)
  }

  @Post(':id/reactions/like')
  like(@Req() request: BertRequest, @Param('id') postId: string) {
    return this.feed.toggleLike(principalFrom(request), postId)
  }

  @Put(':id/subscription')
  subscription(@Req() request: BertRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = updateFeedSubscriptionSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_subscription_invalid')
    return this.feed.updateSubscription(principalFrom(request), postId, parsed.data.notificationMode)
  }

  @Delete(':id/subscription')
  unsubscribe(@Req() request: BertRequest, @Param('id') postId: string) {
    return this.feed.updateSubscription(principalFrom(request), postId, 'NONE')
  }

  @Post(':id/acknowledge')
  acknowledge(@Req() request: BertRequest, @Param('id') postId: string, @Body() rawBody: unknown) {
    const parsed = acknowledgeFeedPostSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('feed_acknowledgement_invalid')
    return this.feed.acknowledge(principalFrom(request), postId, parsed.data.acknowledgementVersion)
  }
}
