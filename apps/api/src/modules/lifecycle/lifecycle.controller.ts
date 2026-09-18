import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { LifecycleService } from './lifecycle.service.js'

@Controller('lifecycle/processes')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  list(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.lifecycle.list(principalFrom(request), company)
  }

  @Get(':id')
  detail(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.lifecycle.detail(principalFrom(request), id)
  }

  @Post()
  start(@Req() request: LankaDWSRequest, @Body() body: { companyId?: string; employeeId: string; startAt: string; endAt?: string }) {
    return this.lifecycle.start(principalFrom(request), body)
  }

  @Post(':id/complete')
  complete(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: { expectedVersion: number; ownershipTransferred: boolean }) {
    return this.lifecycle.complete(principalFrom(request), id, body.expectedVersion, body.ownershipTransferred)
  }
}
