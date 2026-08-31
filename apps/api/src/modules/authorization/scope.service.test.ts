import { describe, expect, it } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ScopeService } from './scope.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_test',
  workspaceId: 'ws_test',
  username: 'test',
  displayName: 'Test User',
  accountType: 'USER',
  primaryCompanyId: 'cmp_organization',
  allowedCompanyIds: ['cmp_organization', 'cmp_legacy'],
  authorizationVersion: 1,
  sessionId: 'ses_test',
  authAssurance: 1,
  restricted: false,
}

describe('ScopeService in workspace-wide company mode', () => {
  const scope = new ScopeService()

  it('resolves an omitted or all scope to every active workspace company', () => {
    expect(scope.allowedCompanies(principal)).toEqual(['cmp_organization', 'cmp_legacy'])
    expect(scope.allowedCompanies(principal, 'all')).toEqual(['cmp_organization', 'cmp_legacy'])
    expect(scope.assertCompany(principal, undefined)).toBe('cmp_organization')
    expect(scope.assertCompany(principal, 'all')).toBe('cmp_organization')
  })

  it('allows selecting any active company in the workspace', () => {
    expect(scope.allowedCompanies(principal, 'cmp_legacy')).toEqual(['cmp_legacy'])
    expect(scope.assertCompany(principal, 'cmp_legacy')).toBe('cmp_legacy')
    expect(() => scope.assertCompany(principal, 'cmp_outside')).toThrow()
  })
})
