import { describe, expect, it } from 'vitest'
import { conversationName, personName, personNamesInLabel, personPatronymic } from './personName'

describe('person names for display', () => {
  it.each(['Петренко Олена Іванівна', 'Петренко Олена Андріївна', 'Петренко Олена Іллівна'])('omits the patronymic in %s', (name) => {
    expect(personName(name)).toBe('Петренко Олена')
    expect(personPatronymic(name)).toBe(name.split(' ').at(-1))
  })

  it('preserves compound surnames and given names', () => {
    expect(personName('де Соуза Анна Марія Петрівна')).toBe('де Соуза Анна Марія')
    expect(personName('Петренко Анна-Марія Петрівна')).toBe('Петренко Анна-Марія')
    expect(personName('Петренко Анна Марія')).toBe('Петренко Анна Марія')
    expect(personName('Олена Савич')).toBe('Олена Савич')
  })

  it('preserves missing values so UI fallback labels still work', () => {
    expect(personName(null)).toBeNull()
    expect(personName(undefined)).toBeUndefined()
    expect(personPatronymic('Олена Петренко')).toBe('')
  })

  it('formats direct-chat titles while preserving group titles', () => {
    expect(conversationName({ kind: 'DIRECT', title: 'Петренко Олена Іванівна' })).toBe('Петренко Олена')
    expect(conversationName({ kind: 'GROUP', title: 'Петренко Олена Іванівна' })).toBe('Петренко Олена Іванівна')
  })

  it('formats generated labels with multiple people and surrounding text', () => {
    expect(personNamesInLabel('Петренко Олена Іванівна вподобала ваше повідомлення')).toBe('Петренко Олена вподобала ваше повідомлення')
    expect(personNamesInLabel('Постановник: Петренко Олена Іванівна')).toBe('Постановник: Петренко Олена')
    expect(personNamesInLabel('Петренко Олена Іванівна, Коваль Іван Петрович')).toBe('Петренко Олена, Коваль Іван')
  })
})
