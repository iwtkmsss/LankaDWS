import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { z } from 'zod'
import { expectedVersionBodySchema, parseBody } from '../../common/validation.js'
import { KnowledgeService } from './knowledge.service.js'

// Structural shape only; the service keeps its specific article_fields/article_audience checks.
const createArticleBodySchema = z.object({
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  companyIds: z.array(z.string()),
  attachmentIds: z.array(z.string()).optional(),
  reviewAt: z.string().optional(),
  requiresAcknowledgement: z.boolean().optional(),
})
const updateArticleBodySchema = z.object({
  title: z.string(),
  body: z.string(),
  changeSummary: z.string(),
  companyIds: z.array(z.string()).optional(),
  attachmentIds: z.array(z.string()).optional(),
  removedAttachmentIds: z.array(z.string()).optional(),
  requiresAcknowledgement: z.boolean().optional(),
  expectedVersion: z.number().int(),
})

@Controller('knowledge/articles')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Req() request: LankaDWSRequest, @Query('search') search?: string) {
    return this.knowledge.list(principalFrom(request), search)
  }

  @Get('summary')
  summary(@Req() request: LankaDWSRequest) {
    return this.knowledge.readingSummary(principalFrom(request))
  }

  @Get(':slug')
  detail(@Req() request: LankaDWSRequest, @Param('slug') slug: string) {
    return this.knowledge.detail(principalFrom(request), slug)
  }

  @Post()
  create(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    return this.knowledge.create(principalFrom(request), parseBody(createArticleBodySchema, body))
  }

  @Post(':slug/acknowledge')
  acknowledge(@Req() request: LankaDWSRequest, @Param('slug') slug: string, @Body() body: unknown) {
    return this.knowledge.acknowledge(principalFrom(request), slug, parseBody(expectedVersionBodySchema, body).expectedVersion)
  }

  @Patch(':slug')
  update(@Req() request: LankaDWSRequest, @Param('slug') slug: string, @Body() body: unknown) {
    return this.knowledge.update(principalFrom(request), slug, parseBody(updateArticleBodySchema, body))
  }

  @Delete(':slug')
  remove(@Req() request: LankaDWSRequest, @Param('slug') slug: string, @Body() body: unknown) {
    return this.knowledge.archive(principalFrom(request), slug, parseBody(expectedVersionBodySchema, body).expectedVersion)
  }
}
