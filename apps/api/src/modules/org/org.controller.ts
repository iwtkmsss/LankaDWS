import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { orgUnitListQuerySchema } from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { OrgService } from './org.service.js'

@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('units')
  listUnits(@Req() request: LankaDWSRequest, @Query() rawQuery: Record<string, unknown>) {
    const normalized = { ...rawQuery, ...(rawQuery.parentId === '' ? { parentId: null } : {}) }
    const parsed = orgUnitListQuerySchema.safeParse(normalized)
    if (!parsed.success) throw badRequest('org_query_invalid')
    return this.org.listUnits(principalFrom(request), parsed.data)
  }

  @Get('units/:id/employees')
  listEmployees(@Req() request: LankaDWSRequest, @Param('id') unitId: string, @Query('company') company?: string) {
    return this.org.listEmployees(principalFrom(request), unitId, company)
  }

  @Get('companies/:id/unassigned-employees')
  listUnassignedEmployees(@Req() request: LankaDWSRequest, @Param('id') companyId: string, @Query('cursor') cursor?: string) {
    if (cursor && cursor.length > 120) throw badRequest('org_query_invalid')
    return this.org.listUnassignedEmployees(principalFrom(request), companyId, cursor)
  }
}
