import { describe, expect, it } from 'vitest'
import { adminUserInputSchema, adminUserUpdateInputSchema } from './accounts.js'

const profile = { firstName: 'Іван', lastName: 'Коваль', username: 'ivan', accountType: 'USER', companyId: 'company', isActive: true }

describe('admin account contracts', () => {
  it.each([adminUserInputSchema, adminUserUpdateInputSchema])('requires at least eight password characters after removing whitespace', (schema) => {
    const body = { ...profile, contactEmail: 'ivan@example.com' }
    expect(schema.safeParse({ ...body, password: 'Lake-49!', passwordConfirmation: 'Lake-49!' }).success).toBe(true)
    expect(schema.safeParse({ ...body, password: 'Lake-49', passwordConfirmation: 'Lake-49' }).success).toBe(false)
    expect(schema.safeParse({ ...body, password: 'Lake-49 ', passwordConfirmation: 'Lake-49 ' }).success).toBe(false)
  })

  it('allows explicitly clearing a department and supplying a successor', () => {
    expect(adminUserUpdateInputSchema.parse({ ...profile, orgUnitId: null, newOwnerId: 'successor' }))
      .toMatchObject({ orgUnitId: null, newOwnerId: 'successor' })
  })

  it('preserves omitted assignments as distinct from an explicit clear', () => {
    expect(adminUserUpdateInputSchema.parse(profile)).not.toHaveProperty('orgUnitId')
  })

  it('still validates permanent password editing and confirmation', () => {
    const password = 'CopperMeadowLantern47!'
    expect(adminUserUpdateInputSchema.safeParse({ ...profile, password, passwordConfirmation: password }).success).toBe(true)
    expect(adminUserUpdateInputSchema.safeParse({ ...profile, password, passwordConfirmation: 'DifferentLantern47!' }).success).toBe(false)
  })

  it('does not allow a null department during creation or empty successor IDs', () => {
    expect(adminUserInputSchema.safeParse({ ...profile, contactEmail: 'ivan@example.com', password: 'CopperMeadowLantern47!', passwordConfirmation: 'CopperMeadowLantern47!', orgUnitId: null }).success).toBe(false)
    expect(adminUserUpdateInputSchema.safeParse({ ...profile, newOwnerId: '' }).success).toBe(false)
  })
})
