import { describe, expect, it } from 'vitest'
import { birthdayOccursOn, calendarDateInTimeZone, daysUntilBirthday } from './birthday-highlight.js'

describe('birthday highlight calendar rules', () => {
  it('uses the organization timezone to determine the current calendar day', () => {
    const now = new Date('2026-08-10T21:30:00.000Z')

    expect(calendarDateInTimeZone(now, 'Europe/Kyiv')).toEqual({
      year: 2026,
      month: 8,
      day: 11,
    })
    expect(calendarDateInTimeZone(now, 'America/New_York')).toEqual({
      year: 2026,
      month: 8,
      day: 10,
    })
  })

  it('observes a 29 February birthday on 28 February in non-leap years', () => {
    const leapDayBirthday = new Date('2000-02-29T00:00:00.000Z')

    expect(birthdayOccursOn(leapDayBirthday, { year: 2025, month: 2, day: 28 })).toBe(true)
    expect(birthdayOccursOn(leapDayBirthday, { year: 2025, month: 3, day: 1 })).toBe(false)
    expect(birthdayOccursOn(leapDayBirthday, { year: 2024, month: 2, day: 28 })).toBe(false)
    expect(birthdayOccursOn(leapDayBirthday, { year: 2024, month: 2, day: 29 })).toBe(true)
  })

  it('calculates the distance to each next birthday occurrence', () => {
    const today = { year: 2025, month: 12, day: 30 }

    expect(daysUntilBirthday(new Date('2000-12-30T00:00:00.000Z'), today)).toBe(0)
    expect(daysUntilBirthday(new Date('2000-01-01T00:00:00.000Z'), today)).toBe(2)
    expect(daysUntilBirthday(new Date('2000-12-29T00:00:00.000Z'), today)).toBe(364)
  })
})
