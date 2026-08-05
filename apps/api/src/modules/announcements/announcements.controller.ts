import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { AnnouncementsService } from './announcements.service.js'

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@Req() request: BertRequest, @Query('company') company?: string, @Query('state') state?: string) {
    return this.announcements.list(principalFrom(request), company, state)
  }

  @Post('audience-preview')
  audience(@Req() request: BertRequest, @Body() body: { companyIds: string[]; roleIds?: string[]; userIds?: string[] }) {
    return this.announcements.audiencePreview(principalFrom(request), body)
  }

  @Post()
  create(@Req() request: BertRequest, @Body() body: { title: string; body: string; companyIds: string[]; roleIds?: string[]; userIds?: string[]; isPinned?: boolean; publishAt?: string; expiresAt?: string }) {
    return this.announcements.createDraft(principalFrom(request), body)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') id: string) {
    return this.announcements.detail(principalFrom(request), id)
  }

  @Post(':id/publish')
  publish(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.announcements.publish(principalFrom(request), id, body.expectedVersion)
  }

  @Post(':id/read')
  read(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { read: boolean }) {
    return this.announcements.markRead(principalFrom(request), id, body.read)
  }

  @Post(':id/archive')
  archive(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.announcements.archive(principalFrom(request), id, body.expectedVersion)
  }
}
