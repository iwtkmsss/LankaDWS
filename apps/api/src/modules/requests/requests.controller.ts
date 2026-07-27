import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { RequestsService, type AbsenceInput } from './requests.service.js'

@Controller('requests')
@RequirePermissions(Permission.RequestsRead)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  list(
    @Req() request: BertRequest,
    @Query('company') company?: string,
    @Query('segment') segment?: string,
    @Query('page') page?: string,
    @Query('q') query?: string,
  ) {
    return this.requests.list(principalFrom(request), company, segment, Number(page ?? 1), 25, query)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') id: string) {
    return this.requests.detail(principalFrom(request), id)
  }

  @Post('absence')
  @RequirePermissions(Permission.RequestsCreate)
  submitAbsence(@Req() request: BertRequest, @Body() body: AbsenceInput, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.requests.submitAbsence(principalFrom(request), body, key)
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.RequestsApprove)
  approve(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.requests.approve(principalFrom(request), id, body.expectedVersion, key)
  }

  @Post(':id/return')
  @RequirePermissions(Permission.RequestsApprove)
  returnForChanges(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number; comment: string }) {
    return this.requests.returnForChanges(principalFrom(request), id, body.expectedVersion, body.comment)
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.RequestsApprove)
  reject(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number; comment: string }) {
    return this.requests.reject(principalFrom(request), id, body.expectedVersion, body.comment)
  }

  @Post(':id/cancel')
  cancel(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number }) {
    return this.requests.cancel(principalFrom(request), id, body.expectedVersion)
  }
}
