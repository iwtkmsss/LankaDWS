const dateTime = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short' })
const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' })

export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value))
export const formatDate = (value: string | Date) => shortDate.format(new Date(value))
export const formatTime = (value: string | Date) => time.format(new Date(value))

/** Badge count capped for display: 1…99, then «99+». */
export const formatCount = (n: number): string => (n > 99 ? '99+' : String(n))

const ukPlural = new Intl.PluralRules('uk')
/** Ukrainian noun form for count n: [one, few, many], e.g. pluralUk(2, ['підрозділ', 'підрозділи', 'підрозділів']). */
export function pluralUk(n: number, [one, few, many]: readonly [string, string, string]): string {
  const rule = ukPlural.select(Math.abs(n))
  return rule === 'one' ? one : rule === 'few' ? few : many
}

/** Human file size with a Ukrainian decimal comma: 512 Б, 14 КБ, 1,3 МБ. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`
}

/** Value for an `<input type="datetime-local">` in the browser's time zone; '' for a missing or invalid date. */
export function toLocalDateTimeInput(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const statusLabels: Record<string, string> = {
  NEW: 'Нове', IN_PROGRESS: 'У роботі', IN_REVIEW: 'На перевірці', DONE: 'Завершене', ARCHIVED: 'Архівоване',
  DRAFT: 'Чернетка', SUBMITTED: 'Подано', PENDING: 'На погодженні', APPROVED: 'Погоджено', RETURNED: 'Повернуто', REJECTED: 'Відхилено',
  NOT_STARTED: 'Не розпочато', QUEUED: 'У черзі', RUNNING: 'Виконується', SUCCEEDED: 'Завершено', PARTIAL_FAILURE: 'Часткова помилка', FAILED: 'Помилка',
  ACTIVE: 'Активний', INACTIVE: 'Деактивований', READY: 'Готово', SUSPENDED: 'Призупинений', PUBLISHED: 'Опубліковано', SCHEDULED: 'Заплановано',
}
