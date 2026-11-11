import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { adminUserInputSchema, adminUserUpdateInputSchema, organizationCapabilityCodeSchema, updateOrganizationCapabilitySchema } from '@lankadws/contracts'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { AdminOnly } from '../auth/auth.decorators.js'
import { badRequest, DomainError } from '../../common/errors.js'
import { z } from 'zod'
import { ADMIN_USER_PAGE_SIZE, AdminService } from './admin.service.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { parseBody } from '../../common/validation.js'
import { getConfig } from '../../config/config.js'

// Reasons stay plain strings so the service keeps its specific blank-reason error codes.
const passwordResetBodySchema = z.object({ reason: z.string(), verificationMethod: z.string() })
const unlockBodySchema = z.object({ reason: z.string() })
const deactivateBodySchema = z.object({ reason: z.string(), newOwnerId: z.string().optional() })
const securityPolicyBodySchema = z.object({
  expectedVersion: z.number().int(),
  require2faAccountTypes: z.array(z.enum(['ADMIN', 'USER'])),
  temporaryPasswordHours: z.number(),
  sessionHours: z.number(),
  effectiveAt: z.string(),
})

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly files: FilesService) {}

  @Get()
  overview(@Req() request: LankaDWSRequest) { return this.admin.overview(principalFrom(request)) }

  @Get('users')
  users(@Req() request: LankaDWSRequest, @Query('search') search?: string, @Query('isActive') isActive?: string, @Query('companyId') companyId?: string, @Query('accountType') accountType?: string, @Query('page') page?: string, @Query('sort') sort = 'displayName', @Query('direction') direction = 'asc') {
    const pageNumber = Number(page ?? 1)
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || (pageNumber - 1) * ADMIN_USER_PAGE_SIZE > 2_147_483_647) throw badRequest('validation_failed')
    if (!['displayName', 'accountType', 'twoFactor', 'isActive'].includes(sort) || !['asc', 'desc'].includes(direction)) throw badRequest('validation_failed')
    return this.admin.users(principalFrom(request), search, isActive, companyId, accountType, pageNumber, sort as 'displayName' | 'accountType' | 'twoFactor' | 'isActive', direction as 'asc' | 'desc')
  }

  @Get('users/:id')
  user(@Req() request: LankaDWSRequest, @Param('id') id: string) { return this.admin.userDetail(principalFrom(request), id) }

  @Post('users')
  createUser(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    const parsed = adminUserInputSchema.safeParse(body)
    if (!parsed.success) throw new DomainError(400, 'validation_failed', 'Перевірте виділені поля.', z.flattenError(parsed.error).fieldErrors)
    return this.admin.createUser(principalFrom(request), parsed.data)
  }

  @Post('users/:id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Math.min(getConfig().MAX_UPLOAD_BYTES, 2 * 1024 * 1024), files: 1 } }))
  async uploadAvatar(@Req() request: LankaDWSRequest, @Param('id') id: string, @UploadedFile() file: UploadedBinary) {
    const principal = principalFrom(request)
    if (!file?.mimetype.startsWith('image/')) throw badRequest('avatar_type')
    const uploaded = await this.files.uploadAvatar(principal, file)
    return this.admin.updateAvatar(principal, id, uploaded.id)
  }

  @Patch('users/:id')
  updateUser(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = adminUserUpdateInputSchema.safeParse(body)
    if (!parsed.success) throw new DomainError(400, 'validation_failed', 'Перевірте виділені поля.', z.flattenError(parsed.error).fieldErrors)
    return this.admin.updateUser(principalFrom(request), id, parsed.data)
  }

  @Post('users/:id/password-reset')
  reset(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.resetPassword(principalFrom(request), id, { ...parseBody(passwordResetBodySchema, body), reauthChallengeId: reauth }) }

  @Post('credential-reset-approvals/:id/approve')
  approveReset(@Req() request: LankaDWSRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.approveReset(principalFrom(request), id, reauth) }

  @Post('credential-reset-approvals/:id/finalize')
  finalizeReset(@Req() request: LankaDWSRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.finalizeReset(principalFrom(request), id, reauth) }

  @Post('users/:id/unlock')
  unlock(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.unlock(principalFrom(request), id, parseBody(unlockBodySchema, body).reason, reauth) }

  @Post('users/:id/deactivate')
  deactivate(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) { return this.admin.deactivate(principalFrom(request), id, parseBody(deactivateBodySchema, body)) }

  @Get('organization/capabilities')
  capabilities(@Req() request: LankaDWSRequest) {
    return this.admin.organizationCapabilities(principalFrom(request))
  }

  @Patch('organization/capabilities/:code')
  updateCapability(@Req() request: LankaDWSRequest, @Param('code') rawCode: string, @Body() body: unknown) {
    const code = organizationCapabilityCodeSchema.safeParse(rawCode)
    const input = updateOrganizationCapabilitySchema.safeParse(body)
    if (!code.success || !input.success) throw badRequest('validation_failed', 'Некоректний capability code або version.')
    return this.admin.updateOrganizationCapability(principalFrom(request), code.data, input.data)
  }

  @Get('audit')
  audit(@Req() request: LankaDWSRequest, @Query('page') page?: string) { return this.admin.auditLog(principalFrom(request), Number(page ?? 1)) }

  @Post('audit/exports')
  auditExport(@Req() request: LankaDWSRequest, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.admin.requestAuditExport(principalFrom(request), key)
  }

  @Get('audit/exports/:id')
  auditExportStatus(@Req() request: LankaDWSRequest, @Param('id') id: string) { return this.admin.auditExportStatus(principalFrom(request), id) }

  @Get('system/jobs')
  jobs() { return this.admin.jobs() }

  @Post('system/jobs/:id/retry')
  retryJob(@Req() request: LankaDWSRequest, @Param('id') id: string) { return this.admin.retryJob(principalFrom(request), id) }

  @Get('security-policy')
  securityPolicy() { return this.admin.securityPolicy() }

  @Patch('security-policy')
  updateSecurityPolicy(@Req() request: LankaDWSRequest, @Body() body: unknown, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.updateSecurityPolicy(principalFrom(request), parseBody(securityPolicyBodySchema, body), reauth) }
}
