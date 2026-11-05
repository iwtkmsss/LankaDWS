export interface CalendarDate {
  year: number
  month: number
  day: number
}

export function calendarDateInTimeZone(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  }
}

export function birthdayOccursOn(birthDate: Date, date: CalendarDate): boolean {
  const birthMonth = birthDate.getUTCMonth() + 1
  const birthDay = birthDate.getUTCDate()
  if (birthMonth === 2 && birthDay === 29 && !isLeapYear(date.year)) {
    return date.month === 2 && date.day === 28
  }
  return date.month === birthMonth && date.day === birthDay
}

export function daysUntilBirthday(birthDate: Date, today: CalendarDate): number {
  const birthdayMonth = birthDate.getUTCMonth() + 1
  const birthdayDay = birthDate.getUTCDate()
  const todayTimestamp = Date.UTC(today.year, today.month - 1, today.day)
  let birthdayTimestamp = birthdayTimestampForYear(birthdayMonth, birthdayDay, today.year)
  if (birthdayTimestamp < todayTimestamp) {
    birthdayTimestamp = birthdayTimestampForYear(birthdayMonth, birthdayDay, today.year + 1)
  }
  return Math.round((birthdayTimestamp - todayTimestamp) / 86_400_000)
}

function birthdayTimestampForYear(month: number, day: number, year: number): number {
  const resolvedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
  return Date.UTC(year, month - 1, resolvedDay)
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
