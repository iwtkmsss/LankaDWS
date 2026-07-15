import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { DocumentsService } from './documents.service.js'

@Controller('documents')
@RequirePermissions(Permission.DocumentsRead)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Req() request: BertRequest, @Query('company') company?: string, @Query('search') search?: string) {
    return this.documents.list(principalFrom(request), company, search)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') id: string) {
    return this.documents.detail(principalFrom(request), id)
  }

  @Post()
  @RequirePermissions(Permission.DocumentsManage)
  create(@Req() request: BertRequest, @Body() body: { companyId?: string; name: string; fileId: string; changeSummary?: string }) {
    return this.documents.create(principalFrom(request), body)
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.DocumentsManage)
  publish(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.documents.publish(principalFrom(request), id, body.expectedVersion)
  }
}
