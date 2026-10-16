export type TaskStatusGroup = 'ACTIVE' | 'DONE' | 'ALL'
export type TaskStatusPreset = 'DUE_SOON' | 'DEFERRED' | 'OVERDUE' | 'NEW' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'ARCHIVED'

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatusPreset; label: string }> = [
  { value: 'DUE_SOON', label: 'Скоро строк' },
  { value: 'DEFERRED', label: 'Відкладені' },
  { value: 'OVERDUE', label: 'Прострочені' },
  { value: 'NEW', label: 'Нове' },
  { value: 'IN_PROGRESS', label: 'В роботі' },
  { value: 'IN_REVIEW', label: 'На перевірці' },
  { value: 'DONE', label: 'Виконані' },
  { value: 'ARCHIVED', label: 'Архівовані' },
]
const statuses = ['NEW', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'ARCHIVED']
export const TASK_STATUS_GROUPS = [
  { value: 'ACTIVE' as const, label: 'Активні', options: TASK_STATUS_OPTIONS.filter((option) => !['DONE', 'ARCHIVED'].includes(option.value)) },
  { value: 'DONE' as const, label: 'Виконані', options: TASK_STATUS_OPTIONS.filter((option) => option.value === 'DONE') },
  { value: 'ALL' as const, label: 'Усі статуси', options: TASK_STATUS_OPTIONS },
]

export function readTaskStatusFilter(params: URLSearchParams) {
  const rawPreset = params.get('preset') ?? (params.get('overdue') === 'true' ? 'OVERDUE' : 'ALL')
  const status = params.get('status') ?? ''
  const raw = (status || rawPreset).split(',').flatMap((value) => value === 'OTHER_ACTIVE' ? ['IN_PROGRESS', 'IN_REVIEW'] : [value])
  const legacyGroup = TASK_STATUS_GROUPS.find((item) => item.value === params.get('statusGroup'))
  const selected = rawPreset === 'NONE' && !status ? [] : !status && rawPreset === 'ALL'
    ? (legacyGroup?.options ?? TASK_STATUS_OPTIONS).map((option) => option.value)
    : TASK_STATUS_OPTIONS.filter((option) => raw.includes(option.value)).map((option) => option.value)
  const group: TaskStatusGroup = selected.length === 1 && selected[0] === 'DONE' ? 'DONE'
    : selected.some((value) => value === 'DONE' || value === 'ARCHIVED') ? 'ALL' : 'ACTIVE'
  return { group, selected, status, preset: status ? 'ALL' : rawPreset === 'NONE' ? 'NONE'
    : selected.length === TASK_STATUS_OPTIONS.length ? 'ALL' : selected.join(',') || 'NONE' }
}

export function writeTaskStatusFilter(params: URLSearchParams, _group: TaskStatusGroup, selected: TaskStatusPreset[]) {
  const values = TASK_STATUS_OPTIONS.filter((option) => selected.includes(option.value)).map((option) => option.value)
  params.set('statusGroup', 'ALL')
  params.delete('status')
  params.delete('overdue')
  params.delete('page')
  if (values.length && values.every((value) => statuses.includes(value))) {
    params.set('status', values.join(','))
    params.set('preset', 'ALL')
  } else {
    params.set('preset', !values.length ? 'NONE' : values.length === TASK_STATUS_OPTIONS.length ? 'ALL' : values.join(','))
  }
}
