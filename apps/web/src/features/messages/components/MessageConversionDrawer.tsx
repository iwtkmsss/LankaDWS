import type { ChatMessageView, ChatThreadDetail } from '@bert-crm/contracts'
import { useMutation } from '@tanstack/react-query'
import { CalendarPlus, ListTodo } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { api, idempotencyKey, jsonBody } from '../../../shared/api/client'
import {
  Button,
  Drawer,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../../../shared/ui'

function localDateTime(value: Date): string {
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

export function MessageConversionDrawer({
  kind,
  message,
  thread,
  currentUserId,
  onClose,
}: {
  kind: 'task' | 'event'
  message: ChatMessageView
  thread: ChatThreadDetail
  currentUserId: string
  onClose: () => void
}) {
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: () => onClose() })
  const eventWindow = useMemo(() => {
    const start = new Date()
    start.setHours(start.getHours() + 1, 0, 0, 0)
    return { start, end: new Date(start.getTime() + 3_600_000) }
  }, [])
  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api(
      `/messages/${message.id}/${kind === 'task' ? 'task' : 'event'}`,
      {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey(`chat-${kind}`) },
        body: jsonBody(payload),
      },
    ),
    onSuccess: () => closeGuard.closeForSuccess(() => onClose()),
    onError: () => setError(`Не вдалося створити ${kind === 'task' ? 'завдання' : 'подію'}. Спробуйте ще раз.`),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    if (kind === 'task') {
      const deadline = String(data.get('deadline') ?? '')
      create.mutate({
        title,
        assigneeId: String(data.get('assigneeId') ?? currentUserId),
        ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      })
    } else {
      create.mutate({
        title,
        startAt: new Date(String(data.get('startAt'))).toISOString(),
        endAt: new Date(String(data.get('endAt'))).toISOString(),
        sourceTimezone: 'Europe/Kyiv',
        allDay: data.get('allDay') === 'on',
      })
    }
  }

  return (
    <>
      <Drawer
        title={kind === 'task' ? 'Створити завдання' : 'Додати подію'}
        onBeforeClose={closeGuard.shouldClose}
        onRequestClose={closeGuard.requestClose}
      >
        <form className="message-conversion" onChange={() => setDirty(true)} onSubmit={submit}>
        <label>
          Назва
          <input name="title" required minLength={2} maxLength={180} defaultValue={message.body.slice(0, 180)} />
        </label>
        {kind === 'task' ? (
          <>
            <label>
              Виконавець
              <select name="assigneeId" defaultValue={currentUserId}>
                {thread.participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>{participant.displayName}</option>
                ))}
              </select>
            </label>
            <label>
              Дедлайн
              <input type="datetime-local" name="deadline" />
            </label>
          </>
        ) : (
          <>
            <label>
              Початок
              <input type="datetime-local" name="startAt" required defaultValue={localDateTime(eventWindow.start)} />
            </label>
            <label>
              Завершення
              <input type="datetime-local" name="endAt" required defaultValue={localDateTime(eventWindow.end)} />
            </label>
            <label className="message-conversion__check">
              <input type="checkbox" name="allDay" /> Подія на весь день
            </label>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => closeGuard.requestClose('cancel-button')}
            >
              Скасувати
            </Button>
            <Button disabled={create.isPending}>
              {kind === 'task' ? <ListTodo size={17} /> : <CalendarPlus size={17} />}
              {create.isPending ? 'Створюємо…' : 'Створити'}
            </Button>
          </div>
        </form>
      </Drawer>
      <UnsavedChangesDialog
        guard={closeGuard}
        title={kind === 'task' ? 'Закрити створення завдання?' : 'Закрити створення події?'}
        description={kind === 'task'
          ? 'Нове завдання з повідомлення не буде створене.'
          : 'Нова подія з повідомлення не буде створена.'}
      />
    </>
  )
}
