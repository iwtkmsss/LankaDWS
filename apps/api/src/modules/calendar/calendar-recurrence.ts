import { Temporal } from '@js-temporal/polyfill'
import { calendarRecurrenceSchema } from '@lankadws/contracts'

export function readCalendarRecurrence(json: string | null) {
  return json ? calendarRecurrenceSchema.parse(JSON.parse(json)) : null
}

/** Expand from the original local date so month-end and DST never accumulate drift. */
export function calendarOccurrences<T extends {
  id: string; startAt: Date; endAt: Date; sourceTimezone: string; recurrenceJson: string | null
}>(event: T, from: Date, to: Date) {
  const recurrence = readCalendarRecurrence(event.recurrenceJson)
  if (!recurrence) return event.startAt < to && event.endAt >= from ? [{ ...event, occurrenceKey: event.id }] : []
  const anchor = Temporal.Instant.from(event.startAt.toISOString()).toZonedDateTimeISO(event.sourceTimezone)
  const endAnchor = Temporal.Instant.from(event.endAt.toISOString()).toZonedDateTimeISO(event.sourceTimezone)
  const localDuration = anchor.toPlainDateTime().until(endAnchor.toPlainDateTime(), { largestUnit: 'days' })
  const duration = event.endAt.getTime() - event.startAt.getTime()
  const until = recurrence.until ? Date.parse(recurrence.until) : Infinity
  const results: Array<T & { occurrenceKey: string }> = []
  const earliest = new Date(from.getTime() - duration)
  const distance = recurrence.frequency === 'MONTHLY'
    ? (earliest.getUTCFullYear() - event.startAt.getUTCFullYear()) * 12 + earliest.getUTCMonth() - event.startAt.getUTCMonth()
    : (from.getTime() - event.startAt.getTime() - duration) / (86_400_000 * (recurrence.frequency === 'WEEKLY' ? 7 : 1))
  const first = Math.max(0, Math.floor(distance / recurrence.interval) - 2)
  for (let index = first; ; index += 1) {
    const amount = index * recurrence.interval
    const offset = recurrence.frequency === 'DAILY' ? { days: amount }
      : recurrence.frequency === 'WEEKLY' ? { weeks: amount } : { months: amount }
    const next = anchor.add(offset)
    const startAt = new Date(next.epochMilliseconds)
    if (startAt >= to || startAt.getTime() > until) break
    const endAt = localDuration.sign > 0
      ? new Date(next.add(localDuration).epochMilliseconds)
      : new Date(startAt.getTime() + duration)
    if (endAt >= from) results.push({ ...event, startAt, endAt, occurrenceKey: `${event.id}:${startAt.toISOString()}` })
  }
  return results
}
