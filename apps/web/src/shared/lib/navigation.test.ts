import { describe, expect, it } from 'vitest'
import { organizationQueryScope, withCompanyScope } from './navigation'

describe('organization-wide navigation', () => {
  it('does not expose a legacy company scope in the URL', () => {
    expect(withCompanyScope('/tasks?tab=assigned', 'cmp_bert_ua')).toBe('/tasks?tab=assigned')
    expect(withCompanyScope('/tasks/tsk_1', 'all')).toBe('/tasks/tsk_1')
  })

  it('leaves an internal path unchanged without a legacy scope', () => {
    expect(withCompanyScope('/calendar', null)).toBe('/calendar')
  })

  it('uses the aggregate query scope for a global administrator', () => {
    expect(organizationQueryScope(null)).toBe('all')
    expect(organizationQueryScope(undefined)).toBe('all')
    expect(organizationQueryScope('cmp_bert_ua')).toBe('cmp_bert_ua')
  })
})
