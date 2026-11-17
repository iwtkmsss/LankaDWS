import { describe, expect, it } from 'vitest'
import { allocateUsername, sanitizeUsername, transliterate } from './usernames.js'

describe('bitrix usernames', () => {
  it('keeps canonical logins, lower-cased', () => {
    expect(allocateUsername('Ivan.Petrenko', 1, new Set())).toBe('ivan.petrenko')
  })

  it('uses the local part of e-mail logins', () => {
    expect(allocateUsername('olena.b@example.com', 2, new Set())).toBe('olena.b')
  })

  it('transliterates Cyrillic logins', () => {
    expect(transliterate('Щука Їжак')).toBe('shchuka izhak')
    expect(sanitizeUsername('Олена Бондар')).toBe('olena.bondar')
    expect(allocateUsername('Дмитро', 3, new Set())).toBe('dmytro')
  })

  it('falls back to b24-<id> when nothing usable is left', () => {
    expect(allocateUsername('@@', 4, new Set())).toBe('b24-4')
    expect(allocateUsername('ab', 5, new Set())).toBe('b24-5')
    expect(allocateUsername(null, 6, new Set())).toBe('b24-6')
  })

  it('resolves collisions with the Bitrix id', () => {
    const taken = new Set(['admin'])
    expect(allocateUsername('Admin', 7, taken)).toBe('admin-7')
    expect(allocateUsername('aleksei_ry', 8, taken)).toBe('aleksei_ry')
    expect(allocateUsername('ALEKSEI_RY', 9, taken)).toBe('aleksei_ry-9')
    expect(taken.has('aleksei_ry-9')).toBe(true)
  })

  it('never exceeds 32 characters', () => {
    const taken = new Set(['a'.repeat(32)])
    const result = allocateUsername('a'.repeat(40), 123456, taken)
    expect(result).toBe(`${'a'.repeat(25)}-123456`)
    expect(result.length).toBeLessThanOrEqual(32)
  })
})
