const dateTime = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short' })
const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' })

export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value))
export const formatDate = (value: string | Date) => shortDate.format(new Date(value))
export const formatTime = (value: string | Date) => time.format(new Date(value))

export const statusLabels: Record<string, string> = {
  NEW: 'Нове', PLANNED: 'Заплановано', IN_PROGRESS: 'У роботі', IN_REVIEW: 'На перевірці', DONE: 'Виконано', BLOCKED: 'Заблоковано', CANCELLED: 'Скасовано', ARCHIVED: 'Архів',
  DRAFT: 'Чернетка', SUBMITTED: 'Подано', PENDING: 'На погодженні', APPROVED: 'Погоджено', RETURNED: 'Повернуто', REJECTED: 'Відхилено',
  NOT_STARTED: 'Не розпочато', QUEUED: 'У черзі', RUNNING: 'Виконується', SUCCEEDED: 'Завершено', PARTIAL_FAILURE: 'Часткова помилка', FAILED: 'Помилка',
  ACTIVE: 'Активний', PENDING_FIRST_LOGIN: 'Очікує першого входу', SUSPENDED: 'Призупинений', DEACTIVATED: 'Деактивований', PUBLISHED: 'Опубліковано', SCHEDULED: 'Заплановано',
}
