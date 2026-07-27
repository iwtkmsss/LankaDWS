import { describe, expect, it } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ScopeService } from './scope.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_test',
  workspaceId: 'ws_test',
  username: 'test',
  displayName: 'Test User',
  displayRole: 'Працівник',
  primaryCompanyId: 'cmp_organization',
  allowedCompanyIds: ['cmp_organization', 'cmp_legacy'],
  permissions: new Set(),
  authorizationVersion: 1,
  sessionId: 'ses_test',
  authAssurance: 1,
  restricted: false,
}

describe('ScopeService in single-organization mode', () => {
  const scope = new ScopeService()

  it('always resolves an omitted or legacy all scope to the organization', () => {
    expect(scope.allowedCompanies(principal)).toEqual(['cmp_organization'])
    expect(scope.allowedCompanies(principal, 'all')).toEqual(['cmp_organization'])
    expect(scope.assertCompany(principal, undefined)).toBe('cmp_organization')
    expect(scope.assertCompany(principal, 'all')).toBe('cmp_organization')
  })

  it('does not reopen access to legacy additional companies', () => {
    expect(() => scope.allowedCompanies(principal, 'cmp_legacy')).toThrow()
    expect(() => scope.assertCompany(principal, 'cmp_legacy')).toThrow()
  })
})
