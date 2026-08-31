import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { adminOrgUnitListQuerySchema, archiveOrgUnitSchema, assignOrgUnitEmployeesSchema, createOrgUnitSchema, restoreOrgUnitSchema, updateOrgUnitSchema } from '@bert-crm/contracts'
import { badRequest } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { AdminOnly } from '../auth/auth.decorators.js'
import { OrgService } from './org.service.js'

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequest('validation_failed')
  return result.data
}

@AdminOnly()
@Controller('admin/companies/:companyId/org-units')
export class AdminOrgController {
  constructor(private readonly org: OrgService) {}

  @Get()
  list(@Req() request: BertRequest, @Param('companyId') companyId: string, @Query() query: Record<string, unknown>) {
    return this.org.listAdminUnits(principalFrom(request), companyId, parse(adminOrgUnitListQuerySchema, query))
  }

  @Post()
  create(@Req() request: BertRequest, @Param('companyId') companyId: string, @Body() body: unknown) {
    return this.org.createUnit(principalFrom(request), companyId, parse(createOrgUnitSchema, body))
  }

  @Patch(':unitId')
  update(@Req() request: BertRequest, @Param('companyId') companyId: string, @Param('unitId') unitId: string, @Body() body: unknown) {
    return this.org.updateUnit(principalFrom(request), companyId, unitId, parse(updateOrgUnitSchema, body))
  }

  @Put(':unitId/employees')
  assignEmployees(@Req() request: BertRequest, @Param('companyId') companyId: string, @Param('unitId') unitId: string, @Body() body: unknown) {
    return this.org.assignEmployees(principalFrom(request), companyId, unitId, parse(assignOrgUnitEmployeesSchema, body))
  }

  @Post(':unitId/archive')
  archive(@Req() request: BertRequest, @Param('companyId') companyId: string, @Param('unitId') unitId: string, @Body() body: unknown) {
    return this.org.archiveUnit(principalFrom(request), companyId, unitId, parse(archiveOrgUnitSchema, body))
  }

  @Post(':unitId/restore')
  restore(@Req() request: BertRequest, @Param('companyId') companyId: string, @Param('unitId') unitId: string, @Body() body: unknown) {
    return this.org.restoreUnit(principalFrom(request), companyId, unitId, parse(restoreOrgUnitSchema, body))
  }
}
