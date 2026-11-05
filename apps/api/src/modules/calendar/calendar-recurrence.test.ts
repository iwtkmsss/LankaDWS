import { describe, expect, it } from 'vitest'
import { calendarOccurrences } from './calendar-recurrence.js'
import { createCalendarEventSchema } from '@lankadws/contracts'

const event = {
  id: 'evt_1', startAt: new Date('2026-03-28T07:00:00Z'),
  endAt: new Date('2026-03-28T08:00:00Z'), sourceTimezone: 'Europe/Kyiv',
  recurrenceJson: JSON.stringify({ frequency: 'DAILY', interval: 1, until: null }),
}

describe('calendar recurrence', () => {
  it('preserves wall time over DST and includes repeats after the original window', () => {
    const rows = calendarOccurrences(event, new Date('2026-03-29T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))
    expect(rows.map((row) => row.startAt.toISOString())).toEqual(['2026-03-29T06:00:00.000Z', '2026-03-30T06:00:00.000Z'])
    expect(new Set(rows.map((row) => row.occurrenceKey)).size).toBe(2)
  })
  it('anchors monthly repeats to the original day without February drift', () => {
    const rows = calendarOccurrences({ ...event, startAt: new Date('2026-01-31T07:00:00Z'), endAt: new Date('2026-01-31T08:00:00Z'),
      recurrenceJson: JSON.stringify({ frequency: 'MONTHLY', interval: 1, until: '2026-03-31T23:59:59Z' }) },
    new Date('2026-02-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
    expect(rows.map((row) => row.startAt.toISOString())).toEqual(['2026-02-28T07:00:00.000Z', '2026-03-31T06:00:00.000Z'])
  })
  it('limits weekly repeats by interval and inclusive end date', () => {
    const rows = calendarOccurrences({ ...event, recurrenceJson: JSON.stringify({ frequency: 'WEEKLY', interval: 2, until: '2026-04-11T06:00:00Z' }) },
      new Date('2026-03-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
    expect(rows.map((row) => row.startAt.toISOString())).toEqual(['2026-03-28T07:00:00.000Z', '2026-04-11T06:00:00.000Z'])
  })
  it('keeps a full local day across DST and a constrained month end', () => {
    const daily = calendarOccurrences({ ...event, startAt: new Date('2026-03-28T22:00:00Z'), endAt: new Date('2026-03-29T21:00:00Z') },
      new Date('2026-03-29T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))
    expect(daily[1]?.endAt.toISOString()).toBe('2026-03-30T21:00:00.000Z')
    const monthly = calendarOccurrences({ ...event, startAt: new Date('2026-01-30T07:00:00Z'), endAt: new Date('2026-01-31T07:00:00Z'),
      recurrenceJson: JSON.stringify({ frequency: 'MONTHLY', interval: 1, until: null }) },
      new Date('2026-02-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'))
    expect(monthly[0]?.endAt.toISOString()).toBe('2026-03-01T07:00:00.000Z')
  })
  it('rejects invalid recurrence intervals and end dates', () => {
    const input = { companyId: 'cmp_1', title: 'Meeting', startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(), audience: { type: 'PRIVATE' } }
    expect(createCalendarEventSchema.safeParse({ ...input, recurrence: { frequency: 'DAILY', interval: 0 } }).success).toBe(false)
    expect(createCalendarEventSchema.safeParse({ ...input, recurrence: { frequency: 'DAILY', until: '2026-01-01T00:00:00Z' } }).success).toBe(false)
  })
})
