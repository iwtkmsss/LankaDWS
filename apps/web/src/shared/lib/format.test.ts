import { describe, expect, it } from 'vitest'
import { formatCount, formatFileSize, pluralUk, toLocalDateTimeInput } from './format'

describe('formatCount', () => {
  it('caps badge counts at 99+', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(99)).toBe('99')
    expect(formatCount(100)).toBe('99+')
  })
})

describe('pluralUk', () => {
  const forms = ['учасник', 'учасники', 'учасників'] as const
  it('agrees nouns with Ukrainian plural rules', () => {
    const cases: Array<[number, string]> = [[1, 'учасник'], [2, 'учасники'], [4, 'учасники'], [5, 'учасників'], [11, 'учасників'], [12, 'учасників'], [21, 'учасник'], [22, 'учасники'], [0, 'учасників'], [100, 'учасників']]
    for (const [n, expected] of cases) expect(pluralUk(n, forms)).toBe(expected)
  })
})

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
