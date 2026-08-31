import { Injectable } from '@nestjs/common'
import type { AuthPrincipal } from '../../common/request-context.js'
import { forbidden } from '../../common/errors.js'

@Injectable()
export class ScopeService {
  allowedCompanies(principal: AuthPrincipal, requested?: string): string[] {
    if (!requested || requested === 'all') return principal.allowedCompanyIds
    if (!principal.allowedCompanyIds.includes(requested)) throw forbidden()
    return [requested]
  }

  assertCompany(principal: AuthPrincipal, companyId: string | undefined): string {
    const requested = companyId && companyId !== 'all' ? companyId : undefined
    const resolved = requested
      ?? (principal.primaryCompanyId && principal.allowedCompanyIds.includes(principal.primaryCompanyId)
        ? principal.primaryCompanyId
        : principal.allowedCompanyIds[0])
    if (!resolved || !principal.allowedCompanyIds.includes(resolved)) throw forbidden()
    return resolved
  }
}
