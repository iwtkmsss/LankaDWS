import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TASK_DETAIL_PREFERENCE_KEY,
  TASK_DETAIL_PREFERENCE_MODULE,
  TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
  TASK_DETAIL_SECTION_IDS,
  type TaskDetailPreferenceValue,
  type TaskDetailSectionId,
  type UserUiPreferenceResult,
  type UserUiPreferenceView,
} from '@bert-crm/contracts'
import { ChevronDown, ChevronUp, Eye, EyeOff, RotateCcw, Settings2 } from 'lucide-react'
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api, ApiProblem, jsonBody } from '../../../shared/api/client'
import { Button } from '../../../shared/ui'

export const DEFAULT_TASK_DETAIL_PREFERENCE: TaskDetailPreferenceValue = {
  order: [...TASK_DETAIL_SECTION_IDS],
  hidden: [],
  collapsed: [...TASK_DETAIL_SECTION_IDS],
}

const SECTION_LABELS: Record<TaskDetailSectionId, string> = {
  personal: 'Для мене',
  participants: 'Учасники',
  subtasks: 'Підзадачі',
  checklist: 'Контрольний список',
  recurrence: 'Повторення завдання',
  materials: 'Матеріали',
  history: 'Історія змін',
  discussion: 'Обговорення',
}

const preferenceUrl = `/me/ui-preferences/${TASK_DETAIL_PREFERENCE_MODULE}/${TASK_DETAIL_PREFERENCE_KEY}`
const copyPreference = (value: TaskDetailPreferenceValue): TaskDetailPreferenceValue => ({
  order: [...value.order],
  hidden: [...value.hidden],
  collapsed: [...value.collapsed],
})

export interface TaskDetailPreferenceController {
  value: TaskDetailPreferenceValue
  stored: UserUiPreferenceView | null
  isLoading: boolean
  isDirty: boolean
  isSaving: boolean
  message: string
  move: (id: TaskDetailSectionId, direction: -1 | 1) => void
  setVisible: (id: TaskDetailSectionId, visible: boolean) => void
  setCollapsed: (id: TaskDetailSectionId, collapsed: boolean) => void
  save: () => void
  reset: () => void
}

export function useTaskDetailPreference(): TaskDetailPreferenceController {
  const client = useQueryClient()
  const [value, setValue] = useState<TaskDetailPreferenceValue>(() => copyPreference(DEFAULT_TASK_DETAIL_PREFERENCE))
  const [message, setMessage] = useState('')
  const appliedSource = useRef<string | null>(null)
  const query = useQuery({
    queryKey: ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_DETAIL_PREFERENCE_KEY],
    queryFn: () => api<UserUiPreferenceResult>(preferenceUrl),
  })
  const stored = query.data?.preference ?? null
  const source = stored ? `version:${stored.version}` : query.isSuccess ? 'default' : null

  useEffect(() => {
    if (!source || appliedSource.current === source) return
    appliedSource.current = source
    setValue(copyPreference(stored?.value ?? DEFAULT_TASK_DETAIL_PREFERENCE))
    setMessage('')
  }, [source, stored])

  const saveMutation = useMutation({
    mutationFn: () => api<UserUiPreferenceView>(preferenceUrl, {
      method: 'PUT',
      body: jsonBody({
        schemaVersion: TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
        value,
        expectedVersion: stored?.version ?? 0,
      }),
    }),
    onSuccess: (preference) => {
      client.setQueryData<UserUiPreferenceResult>(
        ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_DETAIL_PREFERENCE_KEY],
        { preference },
      )
      setMessage('Вигляд сторінки синхронізовано.')
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Вигляд уже змінено на іншому пристрої. Оновіть сторінку й повторіть.'
          : 'Не вдалося зберегти вигляд сторінки.',
      )
      void client.invalidateQueries({ queryKey: ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_DETAIL_PREFERENCE_KEY] })
    },
  })
  const resetMutation = useMutation({
    mutationFn: () => api<{ deleted: true }>(preferenceUrl, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: stored?.version ?? 0 }),
    }),
    onSuccess: () => {
      appliedSource.current = 'default'
      setValue(copyPreference(DEFAULT_TASK_DETAIL_PREFERENCE))
      client.setQueryData<UserUiPreferenceResult>(
        ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_DETAIL_PREFERENCE_KEY],
        { preference: null },
      )
      setMessage('Відновлено стандартний вигляд.')
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Вигляд уже змінено на іншому пристрої. Оновіть сторінку й повторіть.'
          : 'Не вдалося відновити стандартний вигляд.',
      )
      void client.invalidateQueries({ queryKey: ['ui-preference', TASK_DETAIL_PREFERENCE_MODULE, TASK_DETAIL_PREFERENCE_KEY] })
    },
  })

  const storedValue = stored?.value ?? DEFAULT_TASK_DETAIL_PREFERENCE
  const isDirty = JSON.stringify(value) !== JSON.stringify(storedValue)
  return {
    value,
    stored,
    isLoading: query.isLoading,
    isDirty,
    isSaving: saveMutation.isPending || resetMutation.isPending,
    message,
    move: (id, direction) => setValue((current) => {
      const index = current.order.indexOf(id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.order.length) return current
      const order = [...current.order]
      ;[order[index], order[target]] = [order[target], order[index]]
      return { ...current, order }
    }),
    setVisible: (id, visible) => setValue((current) => ({
      ...current,
      hidden: visible
        ? current.hidden.filter((sectionId) => sectionId !== id)
        : [...current.hidden.filter((sectionId) => sectionId !== id), id],
    })),
    setCollapsed: (id, collapsed) => setValue((current) => ({
      ...current,
      collapsed: collapsed
        ? [...current.collapsed.filter((sectionId) => sectionId !== id), id]
        : current.collapsed.filter((sectionId) => sectionId !== id),
    })),
    save: () => {
      setMessage('')
      saveMutation.mutate()
    },
    reset: () => {
      setMessage('')
      resetMutation.mutate()
    },
  }
}

export function TaskDetailCustomization({ controller }: { controller: TaskDetailPreferenceController }) {
  return (
    <details className="task-detail-customization">
      <summary>
        <Settings2 size={17} />
        Налаштувати сторінку
      </summary>
      <div className="task-detail-customization__body">
        <p>Змініть порядок, видимість і початковий стан секцій. Верхня частина завдання залишається незмінною.</p>
        <ol>
          {controller.value.order.map((id, index) => {
            const visible = !controller.value.hidden.includes(id)
            const collapsed = controller.value.collapsed.includes(id)
            const disabled = controller.isLoading || controller.isSaving
            return (
              <li key={id}>
                <strong>{SECTION_LABELS[id]}</strong>
                <div>
                  <button
                    type="button"
                    aria-label={`Перемістити «${SECTION_LABELS[id]}» вище`}
                    disabled={index === 0 || disabled}
                    onClick={() => controller.move(id, -1)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Перемістити «${SECTION_LABELS[id]}» нижче`}
                    disabled={index === controller.value.order.length - 1 || disabled}
                    onClick={() => controller.move(id, 1)}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={disabled}
                      onChange={(event) => controller.setVisible(id, event.target.checked)}
                    />
                    Показувати
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={collapsed}
                      disabled={!visible || disabled}
                      onChange={(event) => controller.setCollapsed(id, event.target.checked)}
                    />
                    Згорнуто
                  </label>
                </div>
              </li>
            )
          })}
        </ol>
        <div className="task-detail-customization__actions">
          <Button type="button" variant="ghost" disabled={controller.isLoading || controller.isSaving} onClick={controller.reset}>
            <RotateCcw size={16} />
            За замовчуванням
          </Button>
          <Button type="button" disabled={!controller.isDirty || controller.isLoading || controller.isSaving} onClick={controller.save}>
            Зберегти вигляд
          </Button>
        </div>
        {controller.message && <p aria-live="polite">{controller.message}</p>}
      </div>
    </details>
  )
}

interface TaskDetailSectionProps {
  id: TaskDetailSectionId
  label: string
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  disabled?: boolean
  children: ReactNode
}

export function TaskDetailSection({
  id,
  label,
  collapsed = false,
  onCollapsedChange,
  disabled = false,
  children,
}: TaskDetailSectionProps) {
  return (
    <div className={`task-detail-section${collapsed ? ' is-collapsed' : ''}`} data-task-section={id}>
      <div className="task-detail-section__control">
        {collapsed && <strong>{label}</strong>}
        <button
          type="button"
          aria-label={`${collapsed ? 'Розгорнути' : 'Згорнути'} секцію «${label}»`}
          aria-expanded={!collapsed}
          disabled={disabled}
          onClick={() => onCollapsedChange?.(!collapsed)}
        >
          {collapsed ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      {!collapsed && children}
    </div>
  )
}

export function TaskDetailSections({
  controller,
  children,
}: {
  controller: TaskDetailPreferenceController
  children: ReactNode
}) {
  const sections = useMemo(() => {
    const byId = new Map<TaskDetailSectionId, ReactElement<TaskDetailSectionProps>>()
    Children.forEach(children, (child) => {
      if (!isValidElement<TaskDetailSectionProps>(child)) return
      byId.set(child.props.id, child)
    })
    return byId
  }, [children])

  return (
    <div className="task-detail-sections">
      {controller.value.order.map((id) => {
        if (controller.value.hidden.includes(id)) return null
        const section = sections.get(id)
        if (!section) return null
        return cloneElement(section, {
          key: id,
          collapsed: controller.value.collapsed.includes(id),
          disabled: controller.isLoading || controller.isSaving,
          onCollapsedChange: (collapsed) => controller.setCollapsed(id, collapsed),
        })
      })}
    </div>
  )
}
