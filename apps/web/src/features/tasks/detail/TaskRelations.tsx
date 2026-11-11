import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskDetailView } from '@lankadws/contracts'
import { ArrowLeft, ChevronDown, ChevronRight, CirclePlus, Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiProblem, api, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { UserSearchCombobox } from '../../employees/UserSearchCombobox'
import { FormattedTextarea } from '../../../shared/text/FormattedTextarea'
import { DateTimePicker } from '../../../shared/ui/DateTimePicker'
import { Button, StatusBadge } from '../../../shared/ui'

export function TaskRelations({
  id,
  task,
  canManageTask,
  linksOpen,
  setLinksOpen,
  subtaskFormOpen,
  setSubtaskFormOpen,
  markDirty,
  clearDirty,
}: {
  id: string
  task: TaskDetailView
  canManageTask: boolean
  linksOpen: boolean
  setLinksOpen: (open: boolean) => void
  subtaskFormOpen: boolean
  setSubtaskFormOpen: (open: boolean | ((open: boolean) => boolean)) => void
  markDirty: (form: string) => void
  clearDirty: (form: string) => void
}) {
  const client = useQueryClient()
  const location = useLocation()
  const [subtaskError, setSubtaskError] = useState('')
  const createSubtask = useMutation({
    mutationFn: (input: {
      title: string
      description?: string
      assigneeId: string
      deadline?: string
      priority: string
      expectedVersion: number
    }) => api<{ id: string }>(`/tasks/${id}/subtasks`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey('subtask') },
      body: jsonBody(input),
    }),
    onSuccess: () => {
      setSubtaskError('')
      clearDirty('subtask')
      setSubtaskFormOpen(false)
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setSubtaskError(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Завдання вже змінилося. Оновіть його перед додаванням підзадачі.'
          : 'Не вдалося додати підзадачу. Перевірте поля та доступ відповідального.',
      )
    },
  })
  return (
    <details
      className="task-detail-disclosure task-detail-links"
      data-task-section="subtasks"
      open={linksOpen}
      onToggle={(event) => setLinksOpen(event.currentTarget.open)}
    >
      <summary aria-label={`${linksOpen ? 'Згорнути' : 'Розгорнути'} секцію «Зв’язки»`}>
        <span className="task-detail-card-icon"><Link2 size={18} /></span>
        <span>
          <strong>Зв’язки</strong>
          <small>
            {task.parent || task.subtasks.length
              ? `${(task.parent ? 1 : 0) + task.subtasks.length} пов’язаних завдань`
              : 'Батьківське завдання та підзавдання'}
          </small>
        </span>
        <ChevronDown size={18} />
      </summary>
      <div className="task-detail-disclosure__body">
      <section className="task-subtasks" aria-labelledby={`task-subtasks-${id}`}>
        <header>
          <div>
            <h3 id={`task-subtasks-${id}`}>Ієрархія завдання</h3>
            <p>
              {task.subtaskProgress.total
                ? `${task.subtaskProgress.done} із ${task.subtaskProgress.total} завершено`
                : 'Розбийте результат на окремі відповідальні кроки.'}
            </p>
          </div>
          {canManageTask && task.canCreateSubtask && (
            <Button
              type="button"
              variant={subtaskFormOpen ? 'ghost' : 'secondary'}
              aria-expanded={subtaskFormOpen}
              onClick={() => {
                setSubtaskError('')
                if (subtaskFormOpen) clearDirty('subtask')
                setSubtaskFormOpen((value) => !value)
              }}
            >
              <Plus size={16} />
              {subtaskFormOpen ? 'Закрити' : 'Додати підзадачу'}
            </Button>
          )}
        </header>
        {task.parent && (
          <Link
            className="task-parent-link"
            to={`/tasks/${task.parent.id}${location.search}`}
          >
            <ArrowLeft size={15} />
            До батьківського завдання · {task.parent.number}
          </Link>
        )}
        {task.subtaskProgress.total > 0 && (
          <progress
            aria-label="Прогрес підзадач"
            value={task.subtaskProgress.done}
            max={task.subtaskProgress.total}
          />
        )}
        {task.subtasks.length > 0 && (
          <div className="task-subtask-list">
            {task.subtasks.map((subtask) => (
              <Link key={subtask.id} to={`/tasks/${subtask.id}${location.search}`}>
                <span>
                  <strong>{subtask.title}</strong>
                  <small>{subtask.number}</small>
                </span>
                <StatusBadge status={subtask.status} />
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
        {subtaskFormOpen && (
          <form
            className="task-subtask-form"
            onChange={() => markDirty('subtask')}
            onSubmit={(event) => {
              event.preventDefault()
              if (!task) return
              const form = new FormData(event.currentTarget)
              const deadline = String(form.get('deadline') ?? '')
              createSubtask.mutate({
                title: String(form.get('title') ?? ''),
                description: String(form.get('description') ?? '') || undefined,
                assigneeId: String(form.get('assigneeId') ?? ''),
                deadline: deadline ? new Date(deadline).toISOString() : undefined,
                priority: String(form.get('priority') ?? 'MEDIUM'),
                expectedVersion: task.version,
              })
            }}
          >
            <div className="task-subtask-form__intro">
              <strong>Нова підзадача</strong>
              <small>Організаційний контекст успадковується автоматично.</small>
            </div>
            <label className="span-2">
              <span>
                Назва <span aria-hidden="true">*</span>
              </span>
              <input
                name="title"
                maxLength={180}
                required
                autoFocus
                placeholder="Який окремий результат потрібен?"
              />
            </label>
            <UserSearchCombobox
              label="Відповідальний"
              name="assigneeId"
              defaultUser={task.assignee}
            />
            <label>
              Пріоритет
              <select name="priority" defaultValue={task.priority}>
                <option value="LOW">Низький</option>
                <option value="MEDIUM">Середній</option>
                <option value="HIGH">Високий</option>
                <option value="CRITICAL">Терміновий</option>
              </select>
            </label>
            <label className="span-2">
              Строк
              <DateTimePicker name="deadline" type="datetime-local" />
            </label>
            <div className="span-2"><FormattedTextarea label="Опис"
                candidateUrl={`/tasks/${id}/mention-candidates`}
                name="description"
                rows={3}
                maxLength={20000}
                placeholder="Опис завдання"
              />
            </div>
            {subtaskError && (
              <div className="form-error span-2" role="alert">{subtaskError}</div>
            )}
            <div className="form-actions span-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearDirty('subtask')
                  setSubtaskFormOpen(false)
                }}
              >
                Скасувати
              </Button>
              <Button disabled={createSubtask.isPending}>
                <CirclePlus size={16} />
                Створити підзадачу
              </Button>
            </div>
          </form>
        )}
      </section>
      </div>
    </details>
  )
}
