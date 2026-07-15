import { describe, expect, it } from 'vitest'
import { assertPasswordPolicy } from './password-policy.js'

describe('password policy', () => {
  it('accepts a long passphrase unrelated to the account', () => {
    expect(() => assertPasswordPolicy('Copper meadow lantern river 47!', 'maria')).not.toThrow()
  })

  it('rejects short, product-related and username-related secrets', () => {
    expect(() => assertPasswordPolicy('short', 'maria')).toThrow()
    expect(() => assertPasswordPolicy('Bert CRM is my password 2026', 'maria')).toThrow()
    expect(() => assertPasswordPolicy('maria has a very long password', 'maria')).toThrow()
  })

  it('permits the shorter NIST-aligned floor only when 2FA is required', () => {
    expect(() => assertPasswordPolicy('Lake-49!', 'admin', true)).not.toThrow()
    expect(() => assertPasswordPolicy('Lake-49!', 'admin', false)).toThrow()
  })
})
