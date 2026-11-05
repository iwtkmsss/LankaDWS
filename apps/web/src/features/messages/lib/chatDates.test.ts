import { describe, expect, it } from 'vitest'
import { formatChatListTime, formatChatTime } from './chatDates'

describe('formatChatListTime', () => {
  const now = new Date(2026, 10, 3, 12, 0)

  it('shows only the time for today', () => {
    const value = new Date(2026, 10, 3, 9, 5).toISOString()
    expect(formatChatListTime(value, now)).toBe(formatChatTime(value))
  })

  it('says yesterday for the previous day', () => {
    expect(formatChatListTime(new Date(2026, 10, 2, 23, 0).toISOString(), now)).toBe('Учора')
  })

  it('shows the weekday within the last week', () => {
    const value = new Date(2026, 9, 29, 15, 0)
    expect(formatChatListTime(value.toISOString(), now))
      .toBe(new Intl.DateTimeFormat('uk-UA', { weekday: 'short' }).format(value))
  })

  it('shows the date for older messages instead of a bare time', () => {
    expect(formatChatListTime(new Date(2026, 9, 23, 15, 0).toISOString(), now)).toBe('23.10')
  })

  it('adds the year for messages from another year', () => {
    expect(formatChatListTime(new Date(2025, 11, 30, 15, 0).toISOString(), now)).toBe('30.12.25')
  })
})
