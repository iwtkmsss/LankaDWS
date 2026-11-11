import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { expectedVersionBodySchema, parseBody } from '../../common/validation.js'
import { z } from 'zod'
import { DocumentsService } from './documents.service.js'

const createDocumentBodySchema = z.object({ companyId: z.string().optional(), name: z.string(), fileId: z.string() })

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @Req() request: LankaDWSRequest,
    @Query('company') company?: string,
    @Query('search') search?: string,
    @Query('section') section?: string,
    @Query('type') fileType?: string,
    @Query('sort') sort?: string,
  ) {
    return this.documents.list(principalFrom(request), { company, search, section, fileType, sort })
  }

  @Get(':id')
  detail(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.documents.detail(principalFrom(request), id)
  }

  @Post()
  create(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    return this.documents.create(principalFrom(request), parseBody(createDocumentBodySchema, body))
  }

  @Post(':id/publish')
  publish(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.publish(principalFrom(request), id, parseBody(expectedVersionBodySchema, body).expectedVersion)
  }

  @Post(':id/archive')
  archive(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.archive(principalFrom(request), id, parseBody(expectedVersionBodySchema, body).expectedVersion)
  }

  @Post(':id/restore')
  restore(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.restore(principalFrom(request), id, parseBody(expectedVersionBodySchema, body).expectedVersion)
  }
}
