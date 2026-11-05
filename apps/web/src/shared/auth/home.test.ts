import { describe, expect, it } from 'vitest'
import { resolveHomePath } from './home'

describe('resolveHomePath', () => {
  it('lands authenticated users on Feed', () => {
    expect(resolveHomePath({ capabilities: [] })).toBe('/feed')
    expect(resolveHomePath(null)).toBe('/tasks')
  })
})
