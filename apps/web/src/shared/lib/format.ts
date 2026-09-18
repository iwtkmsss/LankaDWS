const dateTime = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short' })
const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' })

export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value))
export const formatDate = (value: string | Date) => shortDate.format(new Date(value))
export const formatTime = (value: string | Date) => time.format(new Date(value))

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export const statusLabels: Record<string, string> = {
  NEW: 'Нове', IN_PROGRESS: 'У роботі', IN_REVIEW: 'На перевірці', DONE: 'Завершене', ARCHIVED: 'Архівоване',
  DRAFT: 'Чернетка', SUBMITTED: 'Подано', PENDING: 'На погодженні', APPROVED: 'Погоджено', RETURNED: 'Повернуто', REJECTED: 'Відхилено',
  NOT_STARTED: 'Не розпочато', QUEUED: 'У черзі', RUNNING: 'Виконується', SUCCEEDED: 'Завершено', PARTIAL_FAILURE: 'Часткова помилка', FAILED: 'Помилка',
  ACTIVE: 'Активний', INACTIVE: 'Деактивований', READY: 'Готово', SUSPENDED: 'Призупинений', PUBLISHED: 'Опубліковано', SCHEDULED: 'Заплановано',
}
