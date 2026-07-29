import { useMutation } from '@tanstack/react-query'
import { FilePlus2, Plus, Trash2 } from 'lucide-react'
import { useState, type CSSProperties, type RefObject } from 'react'
import { Button } from '../../../shared/ui'
import { createProject, createTag, stageTaskAttachment } from './api'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  UpdateTaskCreateDraft,
} from './types'

export function TaskMainSection({
  draft,
  options,
  update,
  titleRef,
  onOptionsChanged,
}: {
  draft: TaskCreateDraft
  options: TaskCreateOptions
  update: UpdateTaskCreateDraft
  titleRef: RefObject<HTMLInputElement | null>
  onOptionsChanged: () => void
}) {
  const [projectName, setProjectName] = useState('')
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#3b72ff')
  const projectMutation = useMutation({
    mutationFn: () => createProject(projectName),
    onSuccess: (project) => {
      update((current) => ({
        ...current,
        projectId: project.id,
        parentTaskId: '',
        relations: [],
      }))
      setProjectName('')
      onOptionsChanged()
    },
  })
  const tagMutation = useMutation({
    mutationFn: () => createTag(tagName, tagColor),
    onSuccess: (tag) => {
      update((current) => ({
        ...current,
        tagIds: [...new Set([...current.tagIds, tag.id])],
      }))
      setTagName('')
      onOptionsChanged()
    },
  })
  const upload = useMutation({
    mutationFn: stageTaskAttachment,
    onSuccess: (attachment) => {
      update((current) => ({
        ...current,
        attachments: [...current.attachments, attachment],
      }))
    },
  })

  return (
    <section className="task-create-section" aria-labelledby="task-create-main-title">
      <header>
        <div>
          <span className="task-create-kicker">Крок 1</span>
          <h3 id="task-create-main-title">Основне</h3>
        </div>
        <p>Контекст, строки та матеріали завдання.</p>
      </header>
      <div className="task-create-fields">
        <label className="span-2">
          Назва завдання <span aria-hidden="true">*</span>
          <input
            ref={titleRef}
            value={draft.title}
            maxLength={200}
            required
            placeholder="Що потрібно зробити?"
            onChange={(event) => update((current) => ({
              ...current,
              title: event.target.value,
            }))}
          />
        </label>
        <label className="span-2">
          Опис
          <textarea
            value={draft.description}
            rows={5}
            maxLength={20_000}
            placeholder="Контекст, очікуваний результат і критерії готовності"
            onChange={(event) => update((current) => ({
              ...current,
              description: event.target.value,
            }))}
          />
        </label>
        <label>
          Проєкт <span className="optional">необов’язково</span>
          <select
            value={draft.projectId}
            onChange={(event) => update((current) => ({
              ...current,
              projectId: event.target.value,
              parentTaskId: '',
              relations: [],
            }))}
          >
            <option value="">Без проєкту</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <label>
          Батьківське завдання <span className="optional">необов’язково</span>
          <select
            value={draft.parentTaskId}
            onChange={(event) => {
              const parent = options.tasks.find((task) => task.id === event.target.value)
              update((current) => ({
                ...current,
                parentTaskId: event.target.value,
                projectId: parent?.projectId ?? current.projectId,
                recurrence: event.target.value ? null : current.recurrence,
              }))
            }}
          >
            <option value="">Без батьківського завдання</option>
            {options.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.number} · {task.title}
              </option>
            ))}
          </select>
        </label>
        <div className="task-create-inline span-2">
          <label>
            Швидко створити проєкт
            <input
              value={projectName}
              maxLength={120}
              placeholder="Назва нового проєкту"
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!projectName.trim() || projectMutation.isPending}
            onClick={() => projectMutation.mutate()}
          >
            <Plus size={16} /> Додати
          </Button>
        </div>
        {projectMutation.isError && (
          <p className="form-error span-2">Не вдалося створити проєкт.</p>
        )}
        <label>
          Пріоритет
          <select
            value={draft.priority}
            onChange={(event) => update((current) => ({
              ...current,
              priority: event.target.value as TaskCreateDraft['priority'],
            }))}
          >
            <option value="LOW">Низький</option>
            <option value="MEDIUM">Середній</option>
            <option value="HIGH">Високий</option>
            <option value="URGENT">Терміновий</option>
          </select>
        </label>
        <div />
        <label>
          Дата початку
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => update((current) => ({
              ...current,
              startsAt: event.target.value,
            }))}
          />
        </label>
        <label>
          Кінцевий термін
          <input
            type="datetime-local"
            value={draft.dueAt}
            min={draft.startsAt || undefined}
            onChange={(event) => update((current) => ({
              ...current,
              dueAt: event.target.value,
            }))}
          />
        </label>
        <fieldset className="task-create-tags span-2">
          <legend>Теги</legend>
          <div className="task-create-chips">
            {options.tags.map((tag) => (
              <label key={tag.id} style={{ '--tag-color': tag.color ?? '#687087' } as CSSProperties}>
                <input
                  type="checkbox"
                  checked={draft.tagIds.includes(tag.id)}
                  onChange={() => update((current) => ({
                    ...current,
                    tagIds: current.tagIds.includes(tag.id)
                      ? current.tagIds.filter((id) => id !== tag.id)
                      : [...current.tagIds, tag.id],
                  }))}
                />
                <span>{tag.name}</span>
              </label>
            ))}
          </div>
          <div className="task-create-tag-new">
            <input
              value={tagName}
              maxLength={50}
              aria-label="Назва нового тегу"
              placeholder="Новий тег"
              onChange={(event) => setTagName(event.target.value)}
            />
            <input
              type="color"
              value={tagColor}
              aria-label="Колір нового тегу"
              onChange={(event) => setTagColor(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!tagName.trim() || tagMutation.isPending}
              onClick={() => tagMutation.mutate()}
            >
              Додати тег
            </Button>
          </div>
          {tagMutation.isError && <p className="form-error">Не вдалося створити тег.</p>}
        </fieldset>
        <div className="task-create-attachments span-2">
          <div>
            <strong>Вкладення</strong>
            <small>До 10 файлів; перевірка починається одразу після вибору.</small>
          </div>
          <label className="button button--secondary">
            <FilePlus2 size={16} /> {upload.isPending ? 'Завантаження…' : 'Додати файл'}
            <input
              type="file"
              disabled={upload.isPending || draft.attachments.length >= 10}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) upload.mutate(file)
                event.target.value = ''
              }}
            />
          </label>
          {upload.isError && <p className="form-error">Не вдалося підготувати файл.</p>}
          {draft.attachments.length > 0 && (
            <ul>
              {draft.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <span>{attachment.fileName}<small>{Math.ceil(attachment.bytes / 1024)} КБ</small></span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Вилучити ${attachment.fileName}`}
                    onClick={() => update((current) => ({
                      ...current,
                      attachments: current.attachments.filter((item) => item.id !== attachment.id),
                    }))}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
