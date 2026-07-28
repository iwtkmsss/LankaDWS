import { describe, expect, it } from 'vitest'
import { withCompanyScope } from './navigation'

describe('organization-wide navigation', () => {
  it('does not expose a legacy company scope in the URL', () => {
    expect(withCompanyScope('/tasks?tab=assigned', 'cmp_bert_ua')).toBe('/tasks?tab=assigned')
    expect(withCompanyScope('/tasks/tsk_1', 'all')).toBe('/tasks/tsk_1')
  })

  it('leaves an internal path unchanged without a legacy scope', () => {
    expect(withCompanyScope('/calendar', null)).toBe('/calendar')
  })
})
