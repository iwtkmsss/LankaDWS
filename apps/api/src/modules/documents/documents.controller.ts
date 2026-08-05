import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { DocumentsService } from './documents.service.js'

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @Req() request: BertRequest,
    @Query('company') company?: string,
    @Query('search') search?: string,
    @Query('section') section?: string,
    @Query('type') fileType?: string,
    @Query('sort') sort?: string,
  ) {
    return this.documents.list(principalFrom(request), { company, search, section, fileType, sort })
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') id: string) {
    return this.documents.detail(principalFrom(request), id)
  }

  @Post()
  create(@Req() request: BertRequest, @Body() body: { companyId?: string; name: string; fileId: string; changeSummary?: string }) {
    return this.documents.create(principalFrom(request), body)
  }

  @Post(':id/publish')
  publish(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.documents.publish(principalFrom(request), id, body.expectedVersion)
  }

  @Post(':id/versions')
  addVersion(
    @Req() request: BertRequest,
    @Param('id') id: string,
    @Body() body: { fileId: string; changeSummary?: string; expectedVersion: number },
  ) {
    return this.documents.addVersion(principalFrom(request), id, body)
  }

  @Post(':id/archive')
  archive(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.documents.archive(principalFrom(request), id, body.expectedVersion)
  }

  @Post(':id/restore')
  restore(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.documents.restore(principalFrom(request), id, body.expectedVersion)
  }
}
