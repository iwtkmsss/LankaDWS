// Bitrix calendar time and repeat rules → LankaDWS Event fields.
// Bitrix keeps DATE_FROM/DATE_TO as local wall time of the event's own timezone (TZ_FROM/TZ_TO);
// DATE_FROM_TS_UTC is not a real UTC instant there, so it is not used.
import { Temporal } from '@js-temporal/polyfill'
import type { CalendarRecurrenceInput } from '@lankadws/contracts'

export const DEFAULT_TIMEZONE = 'Europe/Kyiv'
/** Bitrix server time (naive values without an explicit zone). */
export const SERVER_TIMEZONE = 'Europe/Moscow'

const WINDOWS_ZONES: Record<string, string> = {
  'FLE Standard Time': 'Europe/Kyiv',
  'Russian Standard Time': 'Europe/Moscow',
  'GTB Standard Time': 'Europe/Athens',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Europe Standard Time': 'Europe/Berlin',
  UTC: 'UTC',
}

export function normalizeTimezone(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const candidate = raw === 'Europe/Kiev' ? 'Europe/Kyiv' : WINDOWS_ZONES[raw] ?? raw
  try {
    Temporal.Now.instant().toZonedDateTimeISO(candidate)
    return candidate
  } catch {
    return null
  }
}

function plainDateTime(value: string): Temporal.PlainDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number]
  if (year < 1971 || month < 1 || day < 1) return null
  try {
    return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }, { overflow: 'reject' })
  } catch {
    return null
  }
}

/** Wall time in `timezone` → UTC Date (DST gaps resolve like the app: 'compatible'). */
export function wallTimeToDate(value: string | null | undefined, timezone: string): Date | null {
  const local = value ? plainDateTime(value) : null
  if (!local) return null
  return new Date(local.toZonedDateTime(timezone, { disambiguation: 'compatible' }).epochMilliseconds)
}

export interface EventTimes {
  startAt: Date
  endAt: Date
  sourceTimezone: string
  allDay: boolean
}

export function eventTimes(input: {
  dateFrom: string | null
  dateTo: string | null
  tzFrom: string | null
  tzTo: string | null
  skipTime: string | null
}): EventTimes | null {
  const allDay = input.skipTime === 'Y'
  const fromZone = normalizeTimezone(input.tzFrom)
  const toZone = normalizeTimezone(input.tzTo) ?? fromZone
  const sourceTimezone = fromZone ?? DEFAULT_TIMEZONE
  if (allDay) {
    // An all-day event covers whole calendar days: local midnight to the end of the last day.
    const first = input.dateFrom ? plainDateTime(input.dateFrom) : null
    if (!first) return null
    const last = (input.dateTo ? plainDateTime(input.dateTo) : null) ?? first
    const startAt = new Date(first.toPlainDate().toZonedDateTime({ timeZone: sourceTimezone }).epochMilliseconds)
    const lastDay = Temporal.PlainDate.compare(last.toPlainDate(), first.toPlainDate()) < 0 ? first.toPlainDate() : last.toPlainDate()
    const endAt = new Date(lastDay.add({ days: 1 }).toZonedDateTime({ timeZone: sourceTimezone }).epochMilliseconds - 1)
    return { startAt, endAt, sourceTimezone, allDay }
  }
  const startAt = wallTimeToDate(input.dateFrom, fromZone ?? SERVER_TIMEZONE)
  if (!startAt) return null
  const endCandidate = wallTimeToDate(input.dateTo, toZone ?? SERVER_TIMEZONE)
  const endAt = endCandidate && endCandidate >= startAt ? endCandidate : startAt
  return { startAt, endAt, sourceTimezone, allDay }
}

export type RecurrenceResult =
  | { kind: 'none' }
  | { kind: 'ok'; recurrence: CalendarRecurrenceInput }
  | { kind: 'unsupported'; reason: string }

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/**
 * LankaDWS repeats DAILY/WEEKLY/MONTHLY every `interval` from the start, optionally until a date.
 * Weekly rules on several weekdays, YEARLY and unknown rules have no equivalent and are dropped.
 */
export function convertRrule(rrule: string | null | undefined, times: EventTimes): RecurrenceResult {
  if (!rrule?.trim()) return { kind: 'none' }
  const parts = new Map(rrule.split(';').map((part) => part.split('=') as [string, string | undefined]).filter(([key]) => key).map(([key, value]) => [key.trim().toUpperCase(), (value ?? '').trim()]))
  const frequency = parts.get('FREQ')
  if (frequency !== 'DAILY' && frequency !== 'WEEKLY' && frequency !== 'MONTHLY') return { kind: 'unsupported', reason: `freq_${(frequency ?? 'missing').toLowerCase()}` }
  const interval = Math.min(365, Math.max(1, Number.parseInt(parts.get('INTERVAL') || '1', 10) || 1))
  const zoned = Temporal.Instant.fromEpochMilliseconds(times.startAt.getTime()).toZonedDateTimeISO(times.sourceTimezone)
  if (frequency === 'WEEKLY' && parts.get('BYDAY')) {
    const days = parts.get('BYDAY')!.split(',').map((day) => day.trim().toUpperCase()).filter(Boolean)
    if (days.length !== 1 || days[0] !== WEEKDAYS[zoned.dayOfWeek - 1]) return { kind: 'unsupported', reason: 'weekly_byday' }
  }
  let until: string | null = null
  const untilText = parts.get('UNTIL')
  const untilMatch = untilText ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(untilText) : null
  if (untilMatch && Number(untilMatch[3]) < 2038) {
    const date = Temporal.PlainDate.from({ year: Number(untilMatch[3]), month: Number(untilMatch[2]), day: Number(untilMatch[1]) })
    until = new Date(date.add({ days: 1 }).toZonedDateTime({ timeZone: times.sourceTimezone }).epochMilliseconds - 1).toISOString()
  }
  const count = Number.parseInt(parts.get('COUNT') ?? '', 10)
  if (Number.isFinite(count) && count > 0) {
    const unit = frequency === 'DAILY' ? 'days' : frequency === 'WEEKLY' ? 'weeks' : 'months'
    const last = zoned.add({ [unit]: (count - 1) * interval })
    const byCount = new Date(last.toPlainDate().add({ days: 1 }).toZonedDateTime({ timeZone: times.sourceTimezone }).epochMilliseconds - 1).toISOString()
    if (!until || byCount < until) until = byCount
  }
  if (until && Date.parse(until) < times.startAt.getTime()) until = new Date(times.startAt.getTime()).toISOString()
  return { kind: 'ok', recurrence: { frequency, interval, until } }
}
