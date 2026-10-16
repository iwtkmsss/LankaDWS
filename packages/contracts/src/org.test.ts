import { expect, it } from 'vitest'
import { createOrgUnitSchema, updateOrgUnitSchema } from './org.js'
import { companyInputSchema } from './accounts.js'

it('accepts icon-only updates and clearing icons while rejecting unknown icons', () => {
  expect(updateOrgUnitSchema.parse({ icon: 'scales', expectedVersion: 2 })).toEqual({ icon: 'scales', expectedVersion: 2 })
  expect(updateOrgUnitSchema.safeParse({ icon: null, expectedVersion: 2 }).success).toBe(true)
  expect(createOrgUnitSchema.safeParse({ name: 'Відділ', icon: 'arbitrary' }).success).toBe(false)
  expect(updateOrgUnitSchema.safeParse({ expectedVersion: 2 }).success).toBe(false)
})

it('only accepts logo file IDs, preserving optional and removable logos', () => {
  const company = { name: 'Компанія', slug: 'company' }
  expect(companyInputSchema.parse(company).logoFileId).toBeUndefined()
  expect(companyInputSchema.parse({ ...company, logoFileId: null }).logoFileId).toBeNull()
  expect(companyInputSchema.parse({ ...company, logoFileId: 'file_abc123' }).logoFileId).toBe('file_abc123')
  expect(companyInputSchema.safeParse({ ...company, logoFileId: 'https://example.org/logo.png' }).success).toBe(false)
})
