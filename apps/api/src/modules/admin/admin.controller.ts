import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { adminUserInputSchema, adminUserUpdateInputSchema, organizationCapabilityCodeSchema, updateOrganizationCapabilitySchema } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { AdminOnly } from '../auth/auth.decorators.js'
import { badRequest } from '../../common/errors.js'
import { AdminService } from './admin.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { getConfig } from '../../config/config.js'

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly files: FilesService) {}

  @Get()
  overview(@Req() request: BertRequest) { return this.admin.overview(principalFrom(request)) }

  @Get('users')
  users(@Req() request: BertRequest, @Query('search') search?: string, @Query('isActive') isActive?: string, @Query('companyId') companyId?: string, @Query('accountType') accountType?: string) { return this.admin.users(principalFrom(request), search, isActive, companyId, accountType) }

  @Get('users/:id')
  user(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.userDetail(principalFrom(request), id) }

  @Post('users')
  createUser(@Req() request: BertRequest, @Body() body: unknown) {
    const parsed = adminUserInputSchema.safeParse(body)
    if (!parsed.success) throw badRequest('validation_failed')
    return this.admin.createUser(principalFrom(request), parsed.data)
  }

  @Post('users/:id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Math.min(getConfig().MAX_UPLOAD_BYTES, 2 * 1024 * 1024), files: 1 } }))
  async uploadAvatar(@Req() request: BertRequest, @Param('id') id: string, @UploadedFile() file: UploadedBinary) {
    const principal = principalFrom(request)
    if (!file?.mimetype.startsWith('image/')) throw badRequest('avatar_type')
    const uploaded = await this.files.uploadAvatar(principal, file)
    return this.admin.updateAvatar(principal, id, uploaded.id)
  }

  @Patch('users/:id')
  updateUser(@Req() request: BertRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = adminUserUpdateInputSchema.safeParse(body)
    if (!parsed.success) throw badRequest('validation_failed')
    return this.admin.updateUser(principalFrom(request), id, parsed.data)
  }

  @Post('users/:id/password-reset')
  reset(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string; verificationMethod: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.resetPassword(principalFrom(request), id, { ...body, reauthChallengeId: reauth }) }

  @Post('credential-reset-approvals/:id/approve')
  approveReset(@Req() request: BertRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.approveReset(principalFrom(request), id, reauth) }

  @Post('credential-reset-approvals/:id/finalize')
  finalizeReset(@Req() request: BertRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.finalizeReset(principalFrom(request), id, reauth) }

  @Post('users/:id/unlock')
  unlock(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.unlock(principalFrom(request), id, body.reason, reauth) }

  @Post('users/:id/deactivate')
  deactivate(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string; newOwnerId?: string }) { return this.admin.deactivate(principalFrom(request), id, body) }

  @Get('organization/capabilities')
  capabilities(@Req() request: BertRequest) {
    return this.admin.organizationCapabilities(principalFrom(request))
  }

  @Patch('organization/capabilities/:code')
  updateCapability(@Req() request: BertRequest, @Param('code') rawCode: string, @Body() body: unknown) {
    const code = organizationCapabilityCodeSchema.safeParse(rawCode)
    const input = updateOrganizationCapabilitySchema.safeParse(body)
    if (!code.success || !input.success) throw badRequest('validation_failed', 'Некоректний capability code або version.')
    return this.admin.updateOrganizationCapability(principalFrom(request), code.data, input.data)
  }

  @Get('audit')
  audit(@Req() request: BertRequest, @Query('page') page?: string) { return this.admin.auditLog(principalFrom(request), Number(page ?? 1)) }

  @Post('audit/exports')
  auditExport(@Req() request: BertRequest, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.admin.requestAuditExport(principalFrom(request), key)
  }

  @Get('audit/exports/:id')
  auditExportStatus(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.auditExportStatus(principalFrom(request), id) }

  @Get('system/jobs')
  jobs() { return this.admin.jobs() }

  @Post('system/jobs/:id/retry')
  retryJob(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.retryJob(principalFrom(request), id) }

  @Get('security-policy')
  securityPolicy() { return this.admin.securityPolicy() }

  @Patch('security-policy')
  updateSecurityPolicy(@Req() request: BertRequest, @Body() body: { expectedVersion: number; require2faAccountTypes: Array<'ADMIN' | 'USER'>; temporaryPasswordHours: number; sessionHours: number; effectiveAt: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.updateSecurityPolicy(principalFrom(request), body, reauth) }
}
