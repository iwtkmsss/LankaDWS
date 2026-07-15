import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { KnowledgeService } from './knowledge.service.js'

@Controller('knowledge/articles')
@RequirePermissions(Permission.KnowledgeRead)
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
  @RequirePermissions(Permission.KnowledgeManage)
  create(@Req() request: BertRequest, @Body() body: { slug: string; title: string; body: string; companyIds: string[]; reviewAt?: string }) {
    return this.knowledge.create(principalFrom(request), body)
  }

  @Post(':slug/acknowledge')
  acknowledge(@Req() request: BertRequest, @Param('slug') slug: string, @Body() body: { expectedVersion: number }) {
    return this.knowledge.acknowledge(principalFrom(request), slug, body.expectedVersion)
  }
}
