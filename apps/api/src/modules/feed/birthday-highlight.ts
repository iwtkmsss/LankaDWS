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

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
