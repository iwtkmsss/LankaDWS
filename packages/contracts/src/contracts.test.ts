import { describe, expect, it } from 'vitest'
import { companyScopeSchema, loginInputSchema } from './index.js'

describe('transport schemas', () => {
  it('canonicalizes a nickname and rejects email login identifiers', () => {
    expect(loginInputSchema.parse({ username: 'DMYTRO', password: 'x' }).username).toBe('dmytro')
    expect(() => loginInputSchema.parse({ username: 'dmytro@example.com', password: 'x' })).toThrow()
  })

  it('accepts only explicit company scopes', () => {
    expect(companyScopeSchema.parse('all')).toBe('all')
    expect(companyScopeSchema.parse('cmp_bert')).toBe('cmp_bert')
    expect(() => companyScopeSchema.parse('everything')).toThrow()
  })
})
