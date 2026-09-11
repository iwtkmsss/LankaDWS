import type { TaskRecurrenceFrequency } from '@lankadws/contracts'
import { AlarmClockPlus, Plus, Repeat2, Trash2 } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { randomId } from '../../../shared/api/client'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  TaskReminderDraft,
  UpdateTaskCreateDraft,
} from './types'

const weekdays = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Нд' },
]

function newReminder(): TaskReminderDraft {
  return {
    clientId: randomId(),
    targetType: 'PARTICIPANTS',
    userId: '',
    triggerType: 'AT',
    at: '',
    offsetMinutes: '60',
  }
}

function defaultRecurrence() {
  const startsAt = new Date(Date.now() + 86_400_000)
  startsAt.setSeconds(0, 0)
  return {
    frequency: 'WEEKLY' as TaskRecurrenceFrequency,
    interval: '1',
    startsAt: toLocalDateTime(startsAt),
    daysOfWeek: [startsAt.getDay() || 7],
    dayOfMonth: '',
    endsAt: '',
    maxOccurrences: '',
  }
}

function toLocalDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function TaskPlanningSection({
  draft,
  options,
  update,
  canManageRecurrence,
}: {
  draft: TaskCreateDraft
  options: TaskCreateOptions
  update: UpdateTaskCreateDraft
  canManageRecurrence: boolean
}) {
  return (
    <div className="task-create-planning-section">
      <div className="task-create-planning-block">
        <label>
          Планова оцінка, хвилини
          <input
            type="number"
            min={1}
            max={525_600}
            value={draft.estimatedMinutes}
            placeholder="Наприклад, 90"
            onChange={(event) => update((current) => ({
              ...current,
              estimatedMinutes: event.target.value,
            }))}
          />
        </label>
        <p>Фактичний час можна буде додати вручну або за допомогою таймера.</p>
      </div>
      <div className="task-create-subsection">
        <div className="task-create-subsection__title">
          <span><AlarmClockPlus size={18} aria-hidden /><strong>Нагадування</strong></span>
          <Button
            type="button"
            variant="secondary"
            disabled={draft.reminders.length >= 20}
            onClick={() => update((current) => ({
              ...current,
              reminders: [...current.reminders, newReminder()],
            }))}
          >
            <Plus size={15} /> Додати
          </Button>
        </div>
        {draft.reminders.length === 0 ? (
          <p className="task-create-help">Нагадування ще не налаштовані.</p>
        ) : (
          <div className="task-create-reminders">
            {draft.reminders.map((reminder, index) => (
              <div key={reminder.clientId}>
                <span className="task-create-index">{index + 1}</span>
                <label>
                  Кому
                  <select
                    value={reminder.targetType}
                    onChange={(event) => updateReminder(update, reminder.clientId, {
                      targetType: event.target.value as TaskReminderDraft['targetType'],
                    })}
                  >
                    <option value="PARTICIPANTS">Усім учасникам</option>
                    <option value="USER">Конкретній людині</option>
                  </select>
                </label>
                {reminder.targetType === 'USER' && (
                  <label>
                    Отримувач
                    <select
                      value={reminder.userId}
                      onChange={(event) => updateReminder(update, reminder.clientId, {
                        userId: event.target.value,
                      })}
                    >
                      <option value="" disabled>Оберіть людину</option>
                      {options.users
                        .filter((user) => (
                          user.id === draft.reporterId
                          || draft.participants.some((item) => item.userId === user.id)
                        ))
                        .map((user) => (
                          <option key={user.id} value={user.id}>{user.displayName}</option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Коли
                  <select
                    value={reminder.triggerType}
                    onChange={(event) => updateReminder(update, reminder.clientId, {
                      triggerType: event.target.value as TaskReminderDraft['triggerType'],
                    })}
                  >
                    <option value="AT">Конкретна дата</option>
                    <option value="BEFORE_START">До початку</option>
                    <option value="BEFORE_DUE">До дедлайну</option>
                  </select>
                </label>
                {reminder.triggerType === 'AT' ? (
                  <label>
                    Дата і час
                    <input
                      type="datetime-local"
                      value={reminder.at}
                      onChange={(event) => updateReminder(update, reminder.clientId, {
                        at: event.target.value,
                      })}
                    />
                  </label>
                ) : (
                  <label>
                    За скільки хвилин
                    <input
                      type="number"
                      min={1}
                      max={525_600}
                      value={reminder.offsetMinutes}
                      onChange={(event) => updateReminder(update, reminder.clientId, {
                        offsetMinutes: event.target.value,
                      })}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Видалити нагадування ${index + 1}`}
                  onClick={() => update((current) => ({
                    ...current,
                    reminders: current.reminders.filter(
                      (item) => item.clientId !== reminder.clientId,
                    ),
                  }))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="task-create-subsection">
        <div className="task-create-subsection__title">
          <span><Repeat2 size={18} aria-hidden /><strong>Повторення</strong></span>
          <label className="task-create-switch">
            <input
              type="checkbox"
              checked={Boolean(draft.recurrence)}
              disabled={!canManageRecurrence || Boolean(draft.parentTaskId)}
              onChange={(event) => update((current) => ({
                ...current,
                recurrence: event.target.checked ? defaultRecurrence() : null,
              }))}
            />
            <span>{draft.recurrence ? 'Увімкнено' : 'Вимкнено'}</span>
          </label>
        </div>
        {!canManageRecurrence && (
          <p className="task-create-help">Ваші права не дозволяють керувати повторенням.</p>
        )}
        {draft.parentTaskId && (
          <p className="task-create-help">Підзавдання не можуть бути шаблоном повторення.</p>
        )}
        {draft.recurrence && (
          <div className="task-create-recurrence">
            <label>
              Частота
              <select
                value={draft.recurrence.frequency}
                onChange={(event) => updateRecurrence(update, {
                  frequency: event.target.value as TaskRecurrenceFrequency,
                  daysOfWeek: event.target.value === 'WEEKLY'
                    ? draft.recurrence?.daysOfWeek ?? [1]
                    : [],
                })}
              >
                <option value="DAILY">Щодня</option>
                <option value="WEEKLY">Щотижня</option>
                <option value="MONTHLY">Щомісяця</option>
                <option value="YEARLY">Щороку</option>
              </select>
            </label>
            <label>
              Інтервал
              <input
                type="number"
                min={1}
                max={365}
                value={draft.recurrence.interval}
                onChange={(event) => updateRecurrence(update, {
                  interval: event.target.value,
                })}
              />
            </label>
            <label>
              Перше повторення
              <input
                type="datetime-local"
                value={draft.recurrence.startsAt}
                onChange={(event) => updateRecurrence(update, {
                  startsAt: event.target.value,
                })}
              />
            </label>
            <label>
              Завершити після дати
              <input
                type="datetime-local"
                value={draft.recurrence.endsAt}
                min={draft.recurrence.startsAt}
                onChange={(event) => updateRecurrence(update, {
                  endsAt: event.target.value,
                })}
              />
            </label>
            <label>
              Максимум екземплярів
              <input
                type="number"
                min={2}
                max={10_000}
                value={draft.recurrence.maxOccurrences}
                placeholder="Без обмеження"
                onChange={(event) => updateRecurrence(update, {
                  maxOccurrences: event.target.value,
                })}
              />
            </label>
            {draft.recurrence.frequency === 'MONTHLY' && (
              <label>
                День місяця
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.recurrence.dayOfMonth}
                  placeholder="Як у першій даті"
                  onChange={(event) => updateRecurrence(update, {
                    dayOfMonth: event.target.value,
                  })}
                />
              </label>
            )}
            {draft.recurrence.frequency === 'WEEKLY' && (
              <fieldset className="task-create-weekdays span-2">
                <legend>Дні тижня</legend>
                {weekdays.map((day) => (
                  <label key={day.value}>
                    <input
                      type="checkbox"
                      checked={draft.recurrence?.daysOfWeek.includes(day.value)}
                      onChange={() => updateRecurrence(update, {
                        daysOfWeek: draft.recurrence?.daysOfWeek.includes(day.value)
                          ? draft.recurrence.daysOfWeek.filter((value) => value !== day.value)
                          : [...(draft.recurrence?.daysOfWeek ?? []), day.value].sort(),
                      })}
                    />
                    <span>{day.label}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function updateReminder(
  update: UpdateTaskCreateDraft,
  clientId: string,
  patch: Partial<TaskReminderDraft>,
) {
  update((current) => ({
    ...current,
    reminders: current.reminders.map((reminder) => (
      reminder.clientId === clientId ? { ...reminder, ...patch } : reminder
    )),
  }))
}

function updateRecurrence(
  update: UpdateTaskCreateDraft,
  patch: Partial<NonNullable<TaskCreateDraft['recurrence']>>,
) {
  update((current) => ({
    ...current,
    recurrence: current.recurrence ? { ...current.recurrence, ...patch } : null,
  }))
}
