export function chatDayKey(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function formatChatDay(value: string): string {
  const date = new Date(value)
  const today = new Date()
  if (chatDayKey(value) === chatDayKey(today.toISOString())) return 'Сьогодні'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (chatDayKey(value) === chatDayKey(yesterday.toISOString())) return 'Учора'
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

// Thread lists show one compact stamp per conversation, so anything older than
// today needs a day, otherwise a week-old message reads as today's "15:00".
export function formatChatListTime(value: string, now = new Date()): string {
  const date = new Date(value)
  if (chatDayKey(value) === chatDayKey(now.toISOString())) return formatChatTime(value)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (chatDayKey(value) === chatDayKey(yesterday.toISOString())) return 'Учора'
  const weekAgo = new Date(now)
  weekAgo.setHours(0, 0, 0, 0)
  weekAgo.setDate(weekAgo.getDate() - 6)
  if (date >= weekAgo && date <= now) {
    return new Intl.DateTimeFormat('uk-UA', { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit',
  }).format(date)
}

export function formatChatTime(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
