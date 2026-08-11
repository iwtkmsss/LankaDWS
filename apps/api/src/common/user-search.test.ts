import { describe, expect, it } from 'vitest'
import {
  isUserSearchValueLongEnough,
  normalizeUserSearchValue,
  userSearchCodePointLength,
} from './user-search.js'

describe('normalizeUserSearchValue', () => {
  it('normalizes NFKC, Cyrillic case, whitespace and apostrophes', () => {
    expect(normalizeUserSearchValue('  ОЛЕНА   БОНДАР  ')).toBe('олена бондар')
    expect(normalizeUserSearchValue('ДМИТРО')).toBe('дмитро')
    expect(normalizeUserSearchValue('Мар\u02BCяна')).toBe("мар'яна")
    expect(normalizeUserSearchValue('Мар\u2019яна')).toBe("мар'яна")
    expect(normalizeUserSearchValue('\uff2f\uff4c\uff45\uff4e\uff41')).toBe('olena')
  })

  it('counts Unicode code points after normalization', () => {
    expect(userSearchCodePointLength('  ї ')).toBe(1)
    expect(isUserSearchValueLongEnough(' ї ')).toBe(true)
    expect(isUserSearchValueLongEnough('   ')).toBe(false)
  })
})
