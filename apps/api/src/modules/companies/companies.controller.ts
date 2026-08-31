import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { companyInputSchema, updateCompanyManagerSchema } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { isGlobalAdmin, principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { AdminOnly } from '../auth/auth.decorators.js'
import { CompaniesService } from './companies.service.js'

function parse(value: unknown) {
  const result = companyInputSchema.safeParse(value)
  if (!result.success) throw badRequest('validation_failed', result.error.issues[0]?.message)
  return result.data
}

@AdminOnly()
@Controller('admin/companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Req() request: BertRequest) { return this.companies.list(principalFrom(request)) }

  @Post()
  create(@Body() body: unknown, @Req() request: BertRequest) { return this.companies.create(principalFrom(request), parse(body)) }

  @Get(':companyId')
  detail(@Param('companyId') companyId: string, @Req() request: BertRequest) { return this.companies.detail(principalFrom(request), companyId) }

  @Patch(':companyId')
  update(@Param('companyId') companyId: string, @Body() body: unknown, @Req() request: BertRequest) { return this.companies.update(principalFrom(request), companyId, parse(body)) }

  @Patch(':companyId/manager')
  updateManager(@Param('companyId') companyId: string, @Body() body: unknown, @Req() request: BertRequest) {
    const parsed = updateCompanyManagerSchema.safeParse(body)
    if (!parsed.success) throw badRequest('validation_failed')
    return this.companies.updateManager(principalFrom(request), companyId, parsed.data)
  }

  @Post(':companyId/deactivate')
  deactivate(@Param('companyId') companyId: string, @Req() request: BertRequest) { return this.companies.setActive(principalFrom(request), companyId, false) }

  @Post(':companyId/activate')
  activate(@Param('companyId') companyId: string, @Req() request: BertRequest) { return this.companies.setActive(principalFrom(request), companyId, true) }
}

@Controller('companies')
export class CompanyDirectoryController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Req() request: BertRequest) {
    const principal = principalFrom(request)
    return this.companies.list(principal, !isGlobalAdmin(principal))
  }

  @Get(':companyId')
  detail(@Param('companyId') companyId: string, @Req() request: BertRequest) {
    const principal = principalFrom(request)
    return this.companies.detail(principal, companyId, !isGlobalAdmin(principal))
  }
}
