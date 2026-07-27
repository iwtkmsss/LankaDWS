import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { orgUnitListQuerySchema, Permission } from '@bert-crm/contracts'
import { badRequest } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { OrgService } from './org.service.js'

@Controller('org')
@RequirePermissions(Permission.EmployeesOrgRead)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('units')
  listUnits(@Req() request: BertRequest, @Query() rawQuery: Record<string, unknown>) {
    const normalized = { ...rawQuery, ...(rawQuery.parentId === '' ? { parentId: null } : {}) }
    const parsed = orgUnitListQuerySchema.safeParse(normalized)
    if (!parsed.success) throw badRequest('org_query_invalid')
    return this.org.listUnits(principalFrom(request), parsed.data)
  }

  @Get('units/:id/employees')
  listEmployees(@Req() request: BertRequest, @Param('id') unitId: string, @Query('company') company?: string) {
    return this.org.listEmployees(principalFrom(request), unitId, company)
  }
}
