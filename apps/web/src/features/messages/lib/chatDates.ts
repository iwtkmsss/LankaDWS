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

export function formatChatTime(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
