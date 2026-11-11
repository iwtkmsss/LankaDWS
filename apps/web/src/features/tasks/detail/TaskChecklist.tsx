import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskDetailView } from '@lankadws/contracts'
import { CheckCircle2, ChevronDown, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, jsonBody } from '../../../shared/api/client'
import { Button } from '../../../shared/ui'

export function TaskChecklist({
  id,
  task,
  canManageTask,
  onDraftDirtyChange,
}: {
  id: string
  task: TaskDetailView
  canManageTask: boolean
  onDraftDirtyChange: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const [newItem, setNewItem] = useState('')
  const draftDirty = Boolean(newItem.trim())
  useEffect(() => {
    onDraftDirtyChange(draftDirty)
  }, [draftDirty, onDraftDirtyChange])
  const addItem = useMutation({
    mutationFn: (text: string) => {
      if (!task) throw new Error('task_checklist_context')
      return api(`/tasks/${id}/checklist`, {
        method: 'POST',
        body: jsonBody({ title: text, expectedVersion: task.version }),
      })
    },
    onSuccess: () => {
      setNewItem('')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  const updateItem = useMutation({
    mutationFn: (item: { id: string; isDone: boolean }) => {
      if (!task) throw new Error('task_checklist_context')
      return api(`/tasks/${id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: jsonBody({ isCompleted: item.isDone, expectedVersion: task.version }),
      })
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['task', id] }),
  })
  return (
    <details className="task-detail-disclosure" data-task-section="checklist">
    <summary aria-label="Чек-лист">
      <span className="task-detail-card-icon"><ListChecks size={18} /></span>
      <span>
        <strong>Чек-лист</strong>
        <small>{task.checklist.length ? `${task.checklist.filter((item) => item.isDone).length} із ${task.checklist.length} виконано` : 'Конкретні кроки до результату'}</small>
      </span>
      <ChevronDown size={18} />
    </summary>
    <div className="task-detail-disclosure__body">
    <section>
      {task.checklist?.length ? (
        <div className="checklist">
          {task.checklist.map((item) => (
            <label className="checklist-row" key={item.id}>
              <input
                type="checkbox"
                checked={item.isDone}
                disabled={!canManageTask}
                onChange={() =>
                  updateItem.mutate({
                    id: item.id,
                    isDone: !item.isDone,
                  })
                }
              />
              <span>{item.text}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="muted">Кроків немає</p>
      )}
      {canManageTask && (
        <form
          className="inline-add"
          onSubmit={(event) => {
            event.preventDefault()
            if (newItem.trim()) addItem.mutate(newItem)
          }}
        >
          <input
            value={newItem}
            maxLength={240}
            onChange={(event) => setNewItem(event.target.value)}
            placeholder="Додати крок"
          />
          <Button variant="secondary" disabled={addItem.isPending}>
            <CheckCircle2 size={16} />
            Додати
          </Button>
        </form>
      )}
    </section>
    </div>
    </details>
  )
}
