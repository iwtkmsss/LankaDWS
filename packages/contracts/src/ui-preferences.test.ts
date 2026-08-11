import { describe, expect, it } from 'vitest'
import {
  TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
  TASK_DETAIL_SECTION_IDS,
  putTaskDetailPreferenceSchema,
} from './ui-preferences.js'

const value = {
  order: [...TASK_DETAIL_SECTION_IDS],
  hidden: ['history'] as const,
  collapsed: ['materials'] as const,
}

describe('Task Detail UI preference contracts', () => {
  it('accepts the complete stable section order', () => {
    expect(putTaskDetailPreferenceSchema.parse({
      schemaVersion: TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
      value,
      expectedVersion: 0,
    }).value).toEqual(value)
  })

  it('rejects missing, duplicate, and unknown section IDs', () => {
    expect(putTaskDetailPreferenceSchema.safeParse({
      schemaVersion: 1,
      value: { ...value, order: TASK_DETAIL_SECTION_IDS.slice(1) },
      expectedVersion: 0,
    }).success).toBe(false)
    expect(putTaskDetailPreferenceSchema.safeParse({
      schemaVersion: 1,
      value: { ...value, order: TASK_DETAIL_SECTION_IDS.map(() => 'personal') },
      expectedVersion: 0,
    }).success).toBe(false)
    expect(putTaskDetailPreferenceSchema.safeParse({
      schemaVersion: 1,
      value: { ...value, hidden: ['unknown'] },
      expectedVersion: 0,
    }).success).toBe(false)
  })

  it('rejects unsupported schema versions and unexpected fields', () => {
    expect(putTaskDetailPreferenceSchema.safeParse({
      schemaVersion: 2,
      value,
      expectedVersion: 0,
    }).success).toBe(false)
    expect(putTaskDetailPreferenceSchema.safeParse({
      schemaVersion: 1,
      value: { ...value, futureSetting: true },
      expectedVersion: 0,
    }).success).toBe(false)
  })
})

