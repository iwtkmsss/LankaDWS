import { OrganizationCapability, type PrincipalView } from '@bert-crm/contracts'

export function resolveHomePath(user: Pick<PrincipalView, 'capabilities'> | null): '/feed' | '/overview' {
  return user?.capabilities.some(
    (capability) => capability.code === OrganizationCapability.Feed && capability.enabled,
  ) ? '/feed' : '/overview'
}
