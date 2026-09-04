import { OrganizationCapability, type PrincipalView } from '@bert-crm/contracts'
import { describe, expect, it } from 'vitest'
import { resolveHomePath } from './home'

function principalWithFeed(enabled: boolean): Pick<PrincipalView, 'capabilities'> {
  return { capabilities: [{ code: OrganizationCapability.Feed, enabled, version: 1, enabledAt: enabled ? '2026-01-01T00:00:00.000Z' : null, disabledAt: enabled ? null : '2026-01-01T00:00:00.000Z' }] }
}

describe('resolveHomePath', () => {
  it('lands on Feed when available and falls back to Tasks', () => {
    expect(resolveHomePath(principalWithFeed(true))).toBe('/feed')
    expect(resolveHomePath(principalWithFeed(false))).toBe('/tasks')
    expect(resolveHomePath(null)).toBe('/tasks')
  })
})
