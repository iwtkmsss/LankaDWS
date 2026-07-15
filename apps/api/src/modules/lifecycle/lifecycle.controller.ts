import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { LifecycleService } from './lifecycle.service.js'

@Controller('lifecycle/processes')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  @RequirePermissions(Permission.EmployeesRead)
  list(@Req() request: BertRequest, @Query('company') company?: string) {
    return this.lifecycle.list(principalFrom(request), company)
  }

  @Get(':id')
  @RequirePermissions(Permission.EmployeesRead)
  detail(@Req() request: BertRequest, @Param('id') id: string) {
    return this.lifecycle.detail(principalFrom(request), id)
  }

  @Post()
  @RequirePermissions(Permission.LifecycleManage)
  start(@Req() request: BertRequest, @Body() body: { companyId?: string; employeeId: string; processType: 'ONBOARDING' | 'OFFBOARDING'; startAt: string; endAt?: string }) {
    return this.lifecycle.start(principalFrom(request), body)
  }

  @Post(':id/complete')
  @RequirePermissions(Permission.LifecycleManage)
  complete(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number; ownershipTransferred: boolean }) {
    return this.lifecycle.complete(principalFrom(request), id, body.expectedVersion, body.ownershipTransferred)
  }
}
