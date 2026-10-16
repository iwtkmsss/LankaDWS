import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TASK_DETAIL_PREFERENCE_MODULE,
  TASK_LIST_COLUMNS_PREFERENCE_KEY,
  TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION,
  type TaskListColumnId,
  type TaskListColumnsPreferenceValue,
  type TaskListColumnsUserUiPreferenceResult,
  type TaskListColumnsUserUiPreferenceView,
} from '@lankadws/contracts'
import { RotateCcw, Settings2 } from 'lucide-react'
import { api, ApiProblem, jsonBody } from '../../../shared/api/client'
import { Button } from '../../../shared/ui'

export const DEFAULT_TASK_LIST_COLUMNS: TaskListColumnsPreferenceValue = {
  visible: ['responsibles', 'dueDate', 'status'],
}

const columnLabels: Record<TaskListColumnId, string> = {
  responsibles: 'Виконавці',
  dueDate: 'Строк',
  status: 'Статус',
  reporter: 'Постановник',
  priority: 'Пріоритет',
  subtaskProgress: 'Підзадачі',
  activity: 'Активність',
}

const availableColumns: TaskListColumnId[] = [
  'reporter',
  'responsibles',
  'dueDate',
  'status',
  'priority',
  'subtaskProgress',
  'activity',
]

const preferenceUrl = `/me/ui-preferences/${TASK_DETAIL_PREFERENCE_MODULE}/${TASK_LIST_COLUMNS_PREFERENCE_KEY}`
const preferenceQueryKey = ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_LIST_COLUMNS_PREFERENCE_KEY]

export function useTaskListColumnsPreference() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: preferenceQueryKey,
    queryFn: () => api<TaskListColumnsUserUiPreferenceResult>(preferenceUrl),
  })
  const stored = query.data?.preference ?? null
  const value = stored?.value ?? DEFAULT_TASK_LIST_COLUMNS
  const visibleColumns = value.visible.filter((column) => availableColumns.includes(column))
  const save = useMutation({
    mutationFn: (nextValue: TaskListColumnsPreferenceValue) => api<TaskListColumnsUserUiPreferenceView>(preferenceUrl, {
      method: 'PUT',
      body: jsonBody({
        schemaVersion: TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION,
        value: nextValue,
        expectedVersion: stored?.version ?? 0,
      }),
    }),
    onSuccess: (preference) => {
      client.setQueryData<TaskListColumnsUserUiPreferenceResult>(preferenceQueryKey, { preference })
    },
    onError: () => void client.invalidateQueries({ queryKey: preferenceQueryKey }),
  })
  const reset = useMutation({
    mutationFn: () => api<{ deleted: true }>(preferenceUrl, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: stored?.version ?? 0 }),
    }),
    onSuccess: () => {
      client.setQueryData<TaskListColumnsUserUiPreferenceResult>(preferenceQueryKey, { preference: null })
    },
    onError: () => void client.invalidateQueries({ queryKey: preferenceQueryKey }),
  })
  const saving = save.isPending || reset.isPending

  return {
    visible: visibleColumns,
    isLoading: query.isLoading,
    isSaving: saving,
    error: save.error ?? reset.error,
    setVisible: (column: TaskListColumnId, visible: boolean) => {
      const nextVisible = visible
        ? [...visibleColumns, column]
        : visibleColumns.filter((item) => item !== column)
      if (nextVisible.length <= 5) save.mutate({ visible: nextVisible })
    },
    reset: () => reset.mutate(),
  }
}

export function TaskListColumnsControl({ controller }: { controller: ReturnType<typeof useTaskListColumnsPreference> }) {
  const maximumReached = controller.visible.length >= 5
  const errorMessage = controller.error instanceof ApiProblem && controller.error.problem.status === 409
    ? 'Налаштування колонок уже змінено в іншому сеансі. Оновіть сторінку й повторіть дію.'
    : controller.error ? 'Не вдалося зберегти налаштування колонок.' : ''

  return (
    <details className="task-list-columns">
      <summary>
        <Settings2 size={17} />
        Колонки
      </summary>
      <div className="task-list-columns__body">
        <p>Оберіть до 5 додаткових колонок</p>
        {availableColumns.map((column) => {
          const checked = controller.visible.includes(column)
          return (
            <label key={column}>
              <input
                type="checkbox"
                checked={checked}
                disabled={controller.isLoading || controller.isSaving || (!checked && maximumReached)}
                onChange={(event) => controller.setVisible(column, event.target.checked)}
              />
              {columnLabels[column]}
            </label>
          )
        })}
        <Button type="button" variant="ghost" disabled={controller.isLoading || controller.isSaving} onClick={controller.reset}>
          <RotateCcw size={16} />
          За замовчуванням
        </Button>
        {errorMessage && <p role="alert">{errorMessage}</p>}
      </div>
    </details>
  )
}
