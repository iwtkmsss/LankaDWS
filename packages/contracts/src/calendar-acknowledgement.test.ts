import { expect, it } from 'vitest'
import { acknowledgeCalendarEventSchema, createCalendarEventSchema, updateCalendarEventSchema } from './chat.js'

const fields = {
  companyId: 'company', expectedVersion: 1, title: 'Shared meeting',
  startAt: '2099-10-22T09:00:00Z', endAt: '2099-10-22T10:00:00Z',
  requiresAcknowledgement: true,
}

it.each([createCalendarEventSchema, updateCalendarEventSchema])('allows acknowledgement only for a shared audience', (schema) => {
  expect(schema.safeParse({ ...fields, audience: { type: 'COMPANIES', companyIds: ['company'] } }).success).toBe(true)
  expect(schema.safeParse({ ...fields, audience: { type: 'PRIVATE' } }).success).toBe(false)
  expect(schema.safeParse({ ...fields, requiresAcknowledgement: false, audience: { type: 'PRIVATE' } }).success).toBe(true)
})

it('requires the precise positive event version for an acknowledgement', () => {
  expect(acknowledgeCalendarEventSchema.safeParse({ expectedVersion: 1 }).success).toBe(true)
  for (const expectedVersion of [0, -1, 1.5, undefined]) {
    expect(acknowledgeCalendarEventSchema.safeParse({ expectedVersion }).success).toBe(false)
  }
})
