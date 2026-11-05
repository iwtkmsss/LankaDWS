import { describe, expect, it } from 'vitest'
import { assertPasswordPolicy } from './password-policy.js'

describe('password policy', () => {
  it('accepts a long passphrase unrelated to the account', () => {
    expect(() => assertPasswordPolicy('Copper meadow lantern river 47!', 'maria')).not.toThrow()
  })

  it('rejects short, product-related and username-related secrets', () => {
    expect(() => assertPasswordPolicy('short', 'maria')).toThrow()
    expect(() => assertPasswordPolicy('LankaDWS is my password 2026', 'maria')).toThrow()
    expect(() => assertPasswordPolicy('maria has a very long password', 'maria')).toThrow()
  })

  it('accepts exactly eight characters and rejects seven or more than 128', () => {
    expect(() => assertPasswordPolicy('Lake-49!', 'admin')).not.toThrow()
    expect(() => assertPasswordPolicy('Lake-49', 'admin')).toThrow()
    expect(() => assertPasswordPolicy('x'.repeat(129), 'admin')).toThrow()
  })
})
