import { Body, Controller, Get, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { companyInputSchema, createCompanySchema, updateCompanyManagerSchema } from '@lankadws/contracts'
import type { LankaDWSRequest } from '../../common/request-context.js'
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
  constructor(private readonly companies: CompaniesService, private readonly files: FilesService) {}

  @Post('logo-uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  uploadLogo(@Req() request: LankaDWSRequest, @UploadedFile() file: UploadedBinary) {
    return this.files.uploadCompanyLogo(principalFrom(request), file)
  }

  @Get()
  list(@Req() request: LankaDWSRequest) { return this.companies.list(principalFrom(request)) }

  @Post()
  create(@Body() body: unknown, @Req() request: LankaDWSRequest) {
    const parsed = createCompanySchema.safeParse(body)
    if (!parsed.success) throw badRequest('validation_failed', parsed.error.issues[0]?.message)
    return this.companies.create(principalFrom(request), parsed.data)
  }

  @Get(':companyId')
  detail(@Param('companyId') companyId: string, @Req() request: LankaDWSRequest) { return this.companies.detail(principalFrom(request), companyId) }

  @Patch(':companyId')
  update(@Param('companyId') companyId: string, @Body() body: unknown, @Req() request: LankaDWSRequest) { return this.companies.update(principalFrom(request), companyId, parse(body)) }

  @Patch(':companyId/manager')
  updateManager(@Param('companyId') companyId: string, @Body() body: unknown, @Req() request: LankaDWSRequest) {
    const parsed = updateCompanyManagerSchema.safeParse(body)
    if (!parsed.success) throw badRequest('validation_failed')
    return this.companies.updateManager(principalFrom(request), companyId, parsed.data)
  }

  @Post(':companyId/deactivate')
  deactivate(@Param('companyId') companyId: string, @Req() request: LankaDWSRequest) { return this.companies.setActive(principalFrom(request), companyId, false) }

  @Post(':companyId/activate')
  activate(@Param('companyId') companyId: string, @Req() request: LankaDWSRequest) { return this.companies.setActive(principalFrom(request), companyId, true) }
}

@Controller('companies')
export class CompanyDirectoryController {
  constructor(private readonly companies: CompaniesService, private readonly files: FilesService) {}

  @Get(':companyId/logo/:fileId')
  async logo(@Param('companyId') companyId: string, @Param('fileId') fileId: string, @Req() request: LankaDWSRequest, @Res() response: Response) {
    const file = await this.files.downloadCompanyLogo(principalFrom(request), companyId, fileId)
    response.setHeader('Content-Type', file.mime)
    response.setHeader('Content-Disposition', 'inline')
    response.setHeader('Cache-Control', 'private, no-cache')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(file.bytes)
  }

  @Get()
  list(@Req() request: LankaDWSRequest) {
    const principal = principalFrom(request)
    return this.companies.list(principal, !isGlobalAdmin(principal))
  }

  @Get(':companyId')
  detail(@Param('companyId') companyId: string, @Req() request: LankaDWSRequest) {
    const principal = principalFrom(request)
    return this.companies.detail(principal, companyId, !isGlobalAdmin(principal))
  }
}
