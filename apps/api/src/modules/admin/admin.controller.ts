import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { badRequest } from '../../common/errors.js'
import { AdminService } from './admin.service.js'

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @RequirePermissions(Permission.SystemManage)
  overview(@Req() request: BertRequest) { return this.admin.overview(principalFrom(request)) }

  @Get('users')
  @RequirePermissions(Permission.UsersManage)
  users(@Req() request: BertRequest, @Query('search') search?: string, @Query('status') status?: string, @Query('company') company?: string) { return this.admin.users(principalFrom(request), search, status, company) }

  @Get('users/:id')
  @RequirePermissions(Permission.UsersManage)
  user(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.userDetail(principalFrom(request), id) }

  @Post('users')
  @RequirePermissions(Permission.UsersManage)
  createUser(@Req() request: BertRequest, @Body() body: { displayName: string; username: string; roleId: string; companyId: string; jobTitle?: string; contactEmail?: string; approverId?: string }) { return this.admin.createUser(principalFrom(request), body) }

  @Post('users/:id/password-reset')
  @RequirePermissions(Permission.UsersCredentialsReset)
  reset(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string; verificationMethod: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.resetPassword(principalFrom(request), id, { ...body, reauthChallengeId: reauth }) }

  @Post('credential-reset-approvals/:id/approve')
  @RequirePermissions(Permission.UsersCredentialsReset)
  approveReset(@Req() request: BertRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.approveReset(principalFrom(request), id, reauth) }

  @Post('credential-reset-approvals/:id/finalize')
  @RequirePermissions(Permission.UsersCredentialsReset)
  finalizeReset(@Req() request: BertRequest, @Param('id') id: string, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.finalizeReset(principalFrom(request), id, reauth) }

  @Post('users/:id/unlock')
  @RequirePermissions(Permission.UsersSecurityUnlock)
  unlock(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.unlock(principalFrom(request), id, body.reason, reauth) }

  @Post('users/:id/deactivate')
  @RequirePermissions(Permission.UsersManage)
  deactivate(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { reason: string; newOwnerId?: string }) { return this.admin.deactivate(principalFrom(request), id, body) }

  @Get('roles')
  @RequirePermissions(Permission.RolesManage)
  roles(@Req() request: BertRequest) { return this.admin.roles(principalFrom(request)) }

  @Patch('roles/:id')
  @RequirePermissions(Permission.RolesManage)
  updateRole(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { expectedVersion: number; name?: string; permissions: Array<{ code: string; scope: 'OWN' | 'SELECTED_COMPANIES' | 'ALL_COMPANIES'; companyIds?: string[] }> }) { return this.admin.updateRole(principalFrom(request), id, body) }

  @Post('access-preview')
  @RequirePermissions(Permission.RolesManage)
  accessPreview(@Req() request: BertRequest, @Body() body: { userId: string; companyId: string; action: string }) { return this.admin.accessPreview(principalFrom(request), body) }

  @Get('companies')
  @RequirePermissions(Permission.CompaniesManage)
  companies(@Req() request: BertRequest) { return this.admin.companies(principalFrom(request)) }

  @Post('companies')
  @RequirePermissions(Permission.CompaniesManage)
  createCompany(@Req() request: BertRequest, @Body() body: { displayName: string; legalName: string; code: string; timezone: string }) { return this.admin.createCompany(principalFrom(request), body) }

  @Get('audit')
  @RequirePermissions(Permission.AuditRead)
  audit(@Req() request: BertRequest, @Query('page') page?: string) { return this.admin.auditLog(principalFrom(request), Number(page ?? 1)) }

  @Post('audit/exports')
  @RequirePermissions(Permission.AuditExport)
  auditExport(@Req() request: BertRequest, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.admin.requestAuditExport(principalFrom(request), key)
  }

  @Get('audit/exports/:id')
  @RequirePermissions(Permission.AuditExport)
  auditExportStatus(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.auditExportStatus(principalFrom(request), id) }

  @Get('system/jobs')
  @RequirePermissions(Permission.SystemManage)
  jobs() { return this.admin.jobs() }

  @Post('system/jobs/:id/retry')
  @RequirePermissions(Permission.SystemManage)
  retryJob(@Req() request: BertRequest, @Param('id') id: string) { return this.admin.retryJob(principalFrom(request), id) }

  @Get('security-policy')
  @RequirePermissions(Permission.SecurityManage)
  securityPolicy() { return this.admin.securityPolicy() }

  @Patch('security-policy')
  @RequirePermissions(Permission.SecurityManage)
  updateSecurityPolicy(@Req() request: BertRequest, @Body() body: { expectedVersion: number; require2faRoles: string[]; temporaryPasswordHours: number; sessionHours: number; effectiveAt: string }, @Headers('x-reauth-challenge') reauth?: string) { return this.admin.updateSecurityPolicy(principalFrom(request), body, reauth) }
}
