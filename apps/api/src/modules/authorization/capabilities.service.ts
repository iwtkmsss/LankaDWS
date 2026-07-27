import { Injectable } from '@nestjs/common'
import {
  allOrganizationCapabilityCodes,
  type OrganizationCapabilityCode,
  type OrganizationCapabilityView,
} from '@bert-crm/contracts'
import { capabilityDisabled } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from './scope.service.js'

@Injectable()
export class CapabilitiesService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async forOrganization(organizationId: string): Promise<OrganizationCapabilityView[]> {
    const rows = await this.prisma.companyCapability.findMany({
      where: { companyId: organizationId },
      orderBy: { code: 'asc' },
    })
    return allOrganizationCapabilityCodes.map((code) => {
      const row = rows.find((item) => item.code === code)
      return {
        code,
        enabled: row?.enabled ?? false,
        version: row?.version ?? 0,
        enabledAt: row?.enabledAt?.toISOString() ?? null,
        disabledAt: row?.disabledAt?.toISOString() ?? null,
      }
    })
  }

  async effectiveOrganizationIds(
    principal: AuthPrincipal,
    requested: string | undefined,
    capability: OrganizationCapabilityCode,
  ): Promise<string[]> {
    const allowed = this.scope.allowedCompanies(principal, requested)
    const enabled = await this.prisma.companyCapability.findMany({
      where: { companyId: { in: allowed }, code: capability, enabled: true },
      select: { companyId: true },
    })
    const enabledSet = new Set(enabled.map((item) => item.companyId))
    const effective = allowed.filter((companyId) => enabledSet.has(companyId))
    if (requested && requested !== 'all' && effective.length === 0) throw capabilityDisabled()
    return effective
  }

  async assertEnabled(principal: AuthPrincipal, organizationId: string, capability: OrganizationCapabilityCode): Promise<void> {
    this.scope.assertCompany(principal, organizationId)
    const row = await this.prisma.companyCapability.findUnique({
      where: { companyId_code: { companyId: organizationId, code: capability } },
    })
    if (!row?.enabled) throw capabilityDisabled()
  }
}
