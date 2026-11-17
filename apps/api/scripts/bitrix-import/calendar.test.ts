import { describe, expect, it } from 'vitest'
import { convertRrule, eventTimes, normalizeTimezone } from './calendar.js'

describe('bitrix calendar conversion', () => {
  it('normalizes timezone names', () => {
    expect(normalizeTimezone('Europe/Kiev')).toBe('Europe/Kyiv')
    expect(normalizeTimezone('FLE Standard Time')).toBe('Europe/Kyiv')
    expect(normalizeTimezone('Europe/Athens')).toBe('Europe/Athens')
    expect(normalizeTimezone('Not/AZone')).toBeNull()
    expect(normalizeTimezone(null)).toBeNull()
  })

  it('reads timed events as wall time of their own zone', () => {
    const times = eventTimes({ dateFrom: '2018-12-06 17:00:00.000000', dateTo: '2018-12-06 18:00:00.000000', tzFrom: 'Europe/Athens', tzTo: 'Europe/Athens', skipTime: 'N' })
    expect(times?.startAt.toISOString()).toBe('2018-12-06T15:00:00.000Z')
    expect(times?.endAt.toISOString()).toBe('2018-12-06T16:00:00.000Z')
    expect(times?.sourceTimezone).toBe('Europe/Athens')
  })

  it('falls back to server time (MSK) for events without a zone', () => {
    const times = eventTimes({ dateFrom: '2020-03-02 10:00:00', dateTo: '2020-03-02 09:00:00', tzFrom: null, tzTo: null, skipTime: 'N' })
    expect(times?.startAt.toISOString()).toBe('2020-03-02T07:00:00.000Z')
    expect(times?.endAt.toISOString()).toBe('2020-03-02T07:00:00.000Z')
    expect(times?.sourceTimezone).toBe('Europe/Kyiv')
  })

  it('covers whole days for all-day events', () => {
    const times = eventTimes({ dateFrom: '2019-06-27 00:00:00', dateTo: '2019-06-27 00:00:00', tzFrom: null, tzTo: null, skipTime: 'Y' })
    expect(times?.allDay).toBe(true)
    expect(times?.startAt.toISOString()).toBe('2019-06-26T21:00:00.000Z')
    expect(times?.endAt.toISOString()).toBe('2019-06-27T20:59:59.999Z')
  })

  it('converts supported repeat rules', () => {
    const times = eventTimes({ dateFrom: '2019-04-04 10:00:00', dateTo: '2019-04-04 11:00:00', tzFrom: 'Europe/Kiev', tzTo: 'Europe/Kiev', skipTime: 'N' })!
    expect(convertRrule('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;UNTIL=01.01.2038;', times))
      .toEqual({ kind: 'ok', recurrence: { frequency: 'WEEKLY', interval: 1, until: null } })
    expect(convertRrule('FREQ=DAILY;INTERVAL=2;UNTIL=10.04.2019;', times))
      .toEqual({ kind: 'ok', recurrence: { frequency: 'DAILY', interval: 2, until: '2019-04-10T20:59:59.999Z' } })
    expect(convertRrule('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;COUNT=3;UNTIL=01.01.2038;', times))
      .toEqual({ kind: 'ok', recurrence: { frequency: 'WEEKLY', interval: 1, until: '2019-04-18T20:59:59.999Z' } })
    expect(convertRrule('', times)).toEqual({ kind: 'none' })
  })

  it('reports rules without an equivalent', () => {
    const times = eventTimes({ dateFrom: '2019-04-04 10:00:00', dateTo: '2019-04-04 11:00:00', tzFrom: 'Europe/Kiev', tzTo: null, skipTime: 'N' })!
    expect(convertRrule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;UNTIL=28.02.2022;', times)).toEqual({ kind: 'unsupported', reason: 'weekly_byday' })
    expect(convertRrule('FREQ=YEARLY;INTERVAL=1;', times)).toEqual({ kind: 'unsupported', reason: 'freq_yearly' })
  })
})
