import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { KnowledgeService } from './knowledge.service.js'

@Controller('knowledge/articles')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Req() request: BertRequest, @Query('search') search?: string) {
    return this.knowledge.list(principalFrom(request), search)
  }

  @Get(':slug')
  detail(@Req() request: BertRequest, @Param('slug') slug: string) {
    return this.knowledge.detail(principalFrom(request), slug)
  }

  @Post()
  create(@Req() request: BertRequest, @Body() body: { slug: string; title: string; body: string; companyIds: string[]; attachmentIds?: string[]; reviewAt?: string }) {
    return this.knowledge.create(principalFrom(request), body)
  }

  @Post(':slug/acknowledge')
  acknowledge(@Req() request: BertRequest, @Param('slug') slug: string, @Body() body: { expectedVersion: number }) {
    return this.knowledge.acknowledge(principalFrom(request), slug, body.expectedVersion)
  }

  @Patch(':slug')
  update(@Req() request: BertRequest, @Param('slug') slug: string, @Body() body: { title: string; body: string; changeSummary: string; attachmentIds?: string[]; expectedVersion: number }) {
    return this.knowledge.update(principalFrom(request), slug, body)
  }

  @Delete(':slug')
  remove(@Req() request: BertRequest, @Param('slug') slug: string, @Body() body: { expectedVersion: number }) {
    return this.knowledge.archive(principalFrom(request), slug, body.expectedVersion)
  }
}
