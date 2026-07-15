import { Injectable } from '@nestjs/common'
import type { AuthPrincipal } from '../../common/request-context.js'
import { badRequest, forbidden } from '../../common/errors.js'

@Injectable()
export class ScopeService {
  allowedCompanies(principal: AuthPrincipal, requested?: string): string[] {
    if (!requested || requested === 'all') return principal.allowedCompanyIds
    if (!principal.allowedCompanyIds.includes(requested)) throw forbidden()
    return [requested]
  }

  assertCompany(principal: AuthPrincipal, companyId: string | undefined): string {
    if (!companyId || companyId === 'all') throw badRequest('company_required', 'Оберіть конкретну компанію.')
    if (!principal.allowedCompanyIds.includes(companyId)) throw forbidden()
    return companyId
  }
}
