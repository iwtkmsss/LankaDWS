import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskDetailView } from '@lankadws/contracts'
import { Bell, ChevronDown, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, jsonBody } from '../../../shared/api/client'
import { useAuth } from '../../../shared/auth/AuthProvider'
import { formatDateTime } from '../../../shared/lib/format'
import { DateTimePicker } from '../../../shared/ui/DateTimePicker'
import { Button } from '../../../shared/ui'

export function TaskPlanning({
  id,
  task,
  canManageTask,
  markDirty,
  clearDirty,
}: {
  id: string
  task: TaskDetailView
  canManageTask: boolean
  markDirty: (form: string) => void
  clearDirty: (form: string) => void
}) {
  const client = useQueryClient()
  const { user } = useAuth()
  const [recurrenceMessage, setRecurrenceMessage] = useState('')
  const createReminder = useMutation({
    mutationFn: (remindAt: string) => {
      if (!task || !user) throw new Error('task_reminder_context')
      return api(`/tasks/${id}/reminders`, {
        method: 'POST',
        body: jsonBody({
          reminder: {
            target: { type: 'USER', userId: user.id },
            trigger: { type: 'AT', at: remindAt },
          },
          expectedVersion: task.version,
        }),
      })
    },
    onSuccess: () => {
      setRecurrenceMessage('Нагадування заплановано.')
      clearDirty('reminder')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setRecurrenceMessage('Оберіть майбутні дату й час для нагадування.'),
  })
  const cancelReminder = useMutation({
    mutationFn: (reminderId: string) =>
      api(`/tasks/${id}/reminders/${encodeURIComponent(reminderId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setRecurrenceMessage('Нагадування скасовано.')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setRecurrenceMessage('Не вдалося скасувати нагадування.'),
  })
  const recurrence = useMutation({
    mutationFn: (input: { frequency: string; interval: number; firstOccurrenceAt: string; until?: string }) => {
      if (!task) throw new Error('task_recurrence_context')
      const firstOccurrence = new Date(input.firstOccurrenceAt)
      const isoWeekday = firstOccurrence.getUTCDay() || 7
      return api<{ version: number }>(`/tasks/${id}/recurrence`, {
        method: 'PUT',
        body: jsonBody({
          recurrence: {
            frequency: input.frequency,
            interval: input.interval,
            startsAt: input.firstOccurrenceAt,
            ...(input.frequency === 'WEEKLY' ? { daysOfWeek: [isoWeekday] } : {}),
            ...(input.until ? { endsAt: input.until } : {}),
          },
          expectedVersion: task.version,
        }),
      })
    },
    onSuccess: () => {
      setRecurrenceMessage('Повторення налаштовано.')
      clearDirty('recurrence')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  return (
    <details className="task-detail-disclosure" data-task-section="recurrence">
      <summary aria-label="Планування">
        <span className="task-detail-card-icon"><Bell size={18} /></span>
        <span>
          <strong>Планування</strong>
          <small>Нагадування та повторення</small>
        </span>
        <ChevronDown size={18} />
      </summary>
      <div className="task-detail-disclosure__body task-planning">
        <section className="task-reminders" aria-labelledby={`task-reminders-${id}`}>
          <header>
            <h3 id={`task-reminders-${id}`}>Нагадування</h3>
            {task.personalState.reminders.length > 0 && (
              <small>{task.personalState.reminders.length}</small>
            )}
          </header>
          {task.personalState.reminders.length > 0 && (
            <ul>
              {task.personalState.reminders.map((reminder) => (
                <li key={reminder.id}>
                  <span>
                    <Bell size={15} />
                    {formatDateTime(reminder.remindAt)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Скасувати нагадування на ${formatDateTime(reminder.remindAt)}`}
                    disabled={cancelReminder.isPending}
                    onClick={() => cancelReminder.mutate(reminder.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onChange={() => markDirty('reminder')}
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const value = String(form.get('remindAt') ?? '')
              if (value) createReminder.mutate(new Date(value).toISOString())
            }}
          >
            <label>
              Дата й час
              <DateTimePicker name="remindAt" type="datetime-local" required />
            </label>
            <Button variant="secondary" disabled={createReminder.isPending}>
              Запланувати
            </Button>
          </form>
        </section>
        {canManageTask && !task.parentTaskId && <section className="task-recurrence">
        <h3>Повторення завдання</h3>
        <form
          className="recurrence-form"
          onChange={() => markDirty('recurrence')}
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            recurrence.mutate({
              frequency: String(form.get('frequency')),
              interval: Number(form.get('interval')),
              firstOccurrenceAt: new Date(String(form.get('firstOccurrenceAt'))).toISOString(),
              until: form.get('until') ? new Date(String(form.get('until'))).toISOString() : undefined,
            })
          }}
        >
          <label>
            Період
            <select name="frequency" defaultValue="WEEKLY">
              <option value="DAILY">Щодня</option>
              <option value="WEEKLY">Щотижня</option>
              <option value="MONTHLY">Щомісяця</option>
            </select>
          </label>
          <label>
            Інтервал
            <input name="interval" type="number" min="1" max="365" defaultValue="1" required />
          </label>
          <label>
            Перше повторення
            <DateTimePicker name="firstOccurrenceAt" type="datetime-local" required />
          </label>
          <label>
            До дати
            <DateTimePicker name="until" type="datetime-local" />
          </label>
          <Button variant="secondary" disabled={recurrence.isPending}>
            Запланувати
          </Button>
        </form>
        </section>}
        {recurrenceMessage && <p className="success-note">{recurrenceMessage}</p>}
      </div>
    </details>
  )
}
