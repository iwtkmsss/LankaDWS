import { describe, expect, it } from 'vitest'
import { formatFileSize, toLocalDateTimeInput } from './format'

describe('formatFileSize', () => {
  it('uses bytes, kilobytes and megabytes with a Ukrainian decimal comma', () => {
    expect(formatFileSize(1023)).toBe('1023 Б')
    expect(formatFileSize(1024)).toBe('1 КБ')
    expect(formatFileSize(1.3 * 1024 * 1024)).toBe('1,3 МБ')
  })

  it('returns an empty string for an unknown size', () => {
    expect(formatFileSize(null)).toBe('')
    expect(formatFileSize(undefined)).toBe('')
  })
})

describe('toLocalDateTimeInput', () => {
  it('formats a local date for a datetime-local input', () => {
    expect(toLocalDateTimeInput(new Date(2026, 10, 3, 9, 5))).toBe('2026-11-03T09:05')
  })

  it('accepts ISO strings and rejects missing or invalid values', () => {
    const date = new Date(2026, 0, 31, 23, 59)
    expect(toLocalDateTimeInput(date.toISOString())).toBe('2026-01-31T23:59')
    expect(toLocalDateTimeInput(null)).toBe('')
    expect(toLocalDateTimeInput('not a date')).toBe('')
  })
})
