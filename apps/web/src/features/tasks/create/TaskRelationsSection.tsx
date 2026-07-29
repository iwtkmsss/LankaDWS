import type { TaskRelationType } from '@bert-crm/contracts'
import { GitBranch, Link2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../shared/ui'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  UpdateTaskCreateDraft,
} from './types'

const relationLabels: Record<TaskRelationType, string> = {
  RELATED: 'Пов’язане',
  BLOCKS: 'Блокує',
  DUPLICATES: 'Дублікат',
}

export function TaskRelationsSection({
  draft,
  options,
  update,
}: {
  draft: TaskCreateDraft
  options: TaskCreateOptions
  update: UpdateTaskCreateDraft
}) {
  const [targetTaskId, setTargetTaskId] = useState('')
  const [type, setType] = useState<TaskRelationType>('RELATED')
  const [direction, setDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING')

  function addRelation() {
    if (!targetTaskId || draft.relations.some((item) => item.targetTaskId === targetTaskId)) return
    update((current) => ({
      ...current,
      relations: [...current.relations, {
        clientId: crypto.randomUUID(),
        targetTaskId,
        type,
        direction,
      }],
    }))
    setTargetTaskId('')
  }

  return (
    <section className="task-create-section" aria-labelledby="task-create-relations-title">
      <header>
        <div>
          <span className="task-create-kicker">Крок 5</span>
          <h3 id="task-create-relations-title">Зв’язки</h3>
        </div>
        <p>Підзавдання, залежності та пов’язані робочі елементи.</p>
      </header>
      <div className="task-create-hierarchy-note">
        <GitBranch size={19} aria-hidden />
        <span>
          <strong>{draft.parentTaskId ? 'Це підзавдання' : 'Завдання верхнього рівня'}</strong>
          <small>
            {draft.parentTaskId
              ? 'Проєкт і робочий контекст успадковуються від батьківського завдання.'
              : 'Після створення до нього можна додавати підзавдання будь-якої глибини.'}
          </small>
        </span>
      </div>
      <div className="task-create-relation-add">
        <label>
          Завдання
          <select value={targetTaskId} onChange={(event) => setTargetTaskId(event.target.value)}>
            <option value="">Оберіть завдання</option>
            {options.tasks
              .filter((task) => (
                task.id !== draft.parentTaskId
                && !draft.relations.some((relation) => relation.targetTaskId === task.id)
              ))
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.number} · {task.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Тип зв’язку
          <select
            value={type}
            onChange={(event) => setType(event.target.value as TaskRelationType)}
          >
            {Object.entries(relationLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {type === 'BLOCKS' && (
          <label>
            Напрямок
            <select
              value={direction}
              onChange={(event) => setDirection(
                event.target.value as 'OUTGOING' | 'INCOMING',
              )}
            >
              <option value="OUTGOING">Нове завдання блокує вибране</option>
              <option value="INCOMING">Вибране блокує нове завдання</option>
            </select>
          </label>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={!targetTaskId || draft.relations.length >= 100}
          onClick={addRelation}
        >
          <Plus size={16} /> Додати зв’язок
        </Button>
      </div>
      {draft.relations.length === 0 ? (
        <div className="task-create-empty">
          <Link2 size={25} aria-hidden />
          <p>Зв’язків ще немає. Їх можна додати й після створення.</p>
        </div>
      ) : (
        <ul className="task-create-relations">
          {draft.relations.map((relation) => {
            const task = options.tasks.find((item) => item.id === relation.targetTaskId)
            return (
              <li key={relation.clientId}>
                <span className={`task-relation-dot task-relation-dot--${relation.type.toLowerCase()}`} />
                <span>
                  <strong>{task ? `${task.number} · ${task.title}` : relation.targetTaskId}</strong>
                  <small>
                    {relationLabels[relation.type]}
                    {relation.type === 'BLOCKS'
                      ? relation.direction === 'INCOMING' ? ' · блокує нове' : ' · блокується новим'
                      : ''}
                  </small>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Видалити зв’язок із ${task?.title ?? relation.targetTaskId}`}
                  onClick={() => update((current) => ({
                    ...current,
                    relations: current.relations.filter(
                      (item) => item.clientId !== relation.clientId,
                    ),
                  }))}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="task-create-help">
        Циклічні blocking-залежності та дублікати додатково перевіряються сервером.
      </p>
    </section>
  )
}
