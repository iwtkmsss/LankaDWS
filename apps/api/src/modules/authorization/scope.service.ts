import { Injectable } from '@nestjs/common'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { forbidden } from '../../common/errors.js'

@Injectable()
export class ScopeService {
  allowedCompanies(principal: AuthPrincipal, requested?: string): string[] {
    if (isGlobalAdmin(principal)) {
      if (!requested || requested === 'all') return principal.allowedCompanyIds
      if (!principal.allowedCompanyIds.includes(requested)) throw forbidden()
      return [requested]
    }
    const organizationId = principal.primaryCompanyId
    if (!organizationId || (requested && requested !== 'all' && requested !== organizationId)) throw forbidden()
    return [organizationId]
  }

  assertCompany(principal: AuthPrincipal, companyId: string | undefined): string {
    if (isGlobalAdmin(principal)) {
      const resolved = companyId && companyId !== 'all' ? companyId : principal.allowedCompanyIds[0]
      if (!resolved || !principal.allowedCompanyIds.includes(resolved)) throw forbidden()
      return resolved
    }
    const organizationId = principal.primaryCompanyId
    if (!organizationId || (companyId && companyId !== 'all' && companyId !== organizationId)) throw forbidden()
    return organizationId
  }
}
