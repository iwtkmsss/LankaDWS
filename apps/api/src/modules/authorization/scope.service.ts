import { Injectable } from '@nestjs/common'
import type { AuthPrincipal } from '../../common/request-context.js'
import { forbidden } from '../../common/errors.js'

@Injectable()
export class ScopeService {
  allowedCompanies(principal: AuthPrincipal, requested?: string): string[] {
    const organizationId = principal.primaryCompanyId
    if (requested && requested !== 'all' && requested !== organizationId) throw forbidden()
    return [organizationId]
  }

  assertCompany(principal: AuthPrincipal, companyId: string | undefined): string {
    const organizationId = principal.primaryCompanyId
    if (companyId && companyId !== 'all' && companyId !== organizationId) throw forbidden()
    return organizationId
  }
}
