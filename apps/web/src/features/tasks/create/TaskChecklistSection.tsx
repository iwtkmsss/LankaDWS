import { Check, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { randomId } from '../../../shared/api/client'
import { Button } from '../../../shared/ui'
import type { TaskCreateDraft, UpdateTaskCreateDraft } from './types'

export function TaskChecklistSection({
  draft,
  update,
}: {
  draft: TaskCreateDraft
  update: UpdateTaskCreateDraft
}) {
  const [title, setTitle] = useState('')

  function addItem() {
    const normalized = title.trim()
    if (!normalized) return
    update((current) => ({
      ...current,
      checklistItems: [...current.checklistItems, {
        clientId: randomId(),
        title: normalized,
        isCompleted: false,
      }],
    }))
    setTitle('')
  }

  function move(index: number, direction: -1 | 1) {
    update((current) => {
      const next = [...current.checklistItems]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return { ...current, checklistItems: next }
    })
  }

  return (
    <div className="task-create-checklist-section">
      <div className="task-create-checklist-add">
        <label>
          Новий пункт
          <input
            value={title}
            maxLength={300}
            placeholder="Наприклад, погодити прототип"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addItem()
              }
            }}
          />
        </label>
        <Button type="button" variant="secondary" disabled={!title.trim()} onClick={addItem}>
          <Plus size={16} /> Додати
        </Button>
      </div>
      {draft.checklistItems.length === 0 ? (
        <div className="task-create-empty">
          <Check size={25} aria-hidden />
          <p>Пункти можна додати зараз або пізніше в деталях завдання.</p>
        </div>
      ) : (
        <ol className="task-create-checklist">
          {draft.checklistItems.map((item, index) => (
            <li key={item.clientId}>
              <GripVertical size={16} aria-hidden />
              <input
                type="checkbox"
                checked={item.isCompleted}
                aria-label={`Позначити «${item.title}» виконаним`}
                onChange={(event) => update((current) => ({
                  ...current,
                  checklistItems: current.checklistItems.map((currentItem) => (
                    currentItem.clientId === item.clientId
                      ? { ...currentItem, isCompleted: event.target.checked }
                      : currentItem
                  )),
                }))}
              />
              <input
                value={item.title}
                maxLength={300}
                aria-label={`Назва пункту ${index + 1}`}
                onChange={(event) => update((current) => ({
                  ...current,
                  checklistItems: current.checklistItems.map((currentItem) => (
                    currentItem.clientId === item.clientId
                      ? { ...currentItem, title: event.target.value }
                      : currentItem
                  )),
                }))}
              />
              <span className="task-create-order">
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Перемістити «${item.title}» вище`}
                  onClick={() => move(index, -1)}
                >↑</button>
                <button
                  type="button"
                  disabled={index === draft.checklistItems.length - 1}
                  aria-label={`Перемістити «${item.title}» нижче`}
                  onClick={() => move(index, 1)}
                >↓</button>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Видалити «${item.title}»`}
                onClick={() => update((current) => ({
                  ...current,
                  checklistItems: current.checklistItems.filter(
                    (currentItem) => currentItem.clientId !== item.clientId,
                  ),
                }))}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
