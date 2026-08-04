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

export function TaskBasicsSection({
  draft,
  update,
  titleRef,
  dueAtRef,
  invalidField,
}: {
  draft: TaskCreateDraft
  update: UpdateTaskCreateDraft
  titleRef: RefObject<HTMLInputElement | null>
  dueAtRef: RefObject<HTMLInputElement | null>
  invalidField?: string
}) {
  return (
    <section className="task-create-core" aria-labelledby="task-create-basics-title">
      <header className="task-create-core__header">
        <div>
          <span className="task-create-kicker">Основне</span>
          <h3 id="task-create-basics-title">Що потрібно зробити</h3>
        </div>
        <p>Сформулюйте результат так, щоб завдання можна було почати без додаткових уточнень.</p>
      </header>
      <div className="task-create-fields">
        <label className="span-2">
          Назва завдання <span aria-hidden="true">*</span>
          <input
            ref={titleRef}
            value={draft.title}
            maxLength={200}
            required
            aria-invalid={invalidField === 'title' || undefined}
            aria-describedby={invalidField === 'title' ? 'task-create-error' : undefined}
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
      </div>
      <div className="task-create-core__meta">
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
            ref={dueAtRef}
            type="datetime-local"
            value={draft.dueAt}
            min={draft.startsAt || undefined}
            aria-invalid={invalidField === 'dueAt' || undefined}
            aria-describedby={invalidField === 'dueAt' ? 'task-create-error' : undefined}
            onChange={(event) => update((current) => ({
              ...current,
              dueAt: event.target.value,
            }))}
          />
        </label>
      </div>
    </section>
  )
}

export function TaskContextSection({
  draft,
  options,
  optionsLoading,
  optionsError,
  update,
  onRetryOptions,
  onOptionsChanged,
}: {
  draft: TaskCreateDraft
  options?: TaskCreateOptions
  optionsLoading: boolean
  optionsError: boolean
  update: UpdateTaskCreateDraft
  onRetryOptions: () => void
  onOptionsChanged: () => void
}) {
  const [projectName, setProjectName] = useState('')
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#3b72ff')
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [tagCreateOpen, setTagCreateOpen] = useState(false)
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
      setProjectCreateOpen(false)
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
      setTagCreateOpen(false)
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
    <div className="task-create-context">
      <section className="task-create-subgroup" aria-labelledby="task-create-context-project-title">
        <div className="task-create-subgroup__heading">
          <div>
            <h4 id="task-create-context-project-title">Проєкт і батьківське завдання</h4>
            <p>Необов’язковий робочий контекст і місце в ієрархії.</p>
          </div>
          {options && (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={projectCreateOpen}
              onClick={() => setProjectCreateOpen((open) => !open)}
            >
              <Plus size={15} /> Створити проєкт
            </Button>
          )}
        </div>
        {optionsLoading && !options && (
          <p className="task-create-local-state" role="status">Завантажуємо доступні проєкти й завдання…</p>
        )}
        {optionsError && !options && (
          <div className="task-create-local-error">
            <span>Не вдалося завантажити проєкти й завдання.</span>
            <button type="button" onClick={onRetryOptions}>Повторити</button>
          </div>
        )}
        {options && (
          <>
            <div className="task-create-fields">
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
            </div>
            {projectCreateOpen && (
              <div className="task-create-inline">
                <label>
                  Назва нового проєкту
                  <input
                    value={projectName}
                    maxLength={120}
                    placeholder="Наприклад, оновлення сайту"
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
            )}
            {projectMutation.isError && <p className="form-error">Не вдалося створити проєкт.</p>}
          </>
        )}
      </section>

      <section className="task-create-subgroup" aria-labelledby="task-create-context-tags-title">
        <div className="task-create-subgroup__heading">
          <div>
            <h4 id="task-create-context-tags-title">Теги</h4>
            <p>Позначте тему або напрям роботи.</p>
          </div>
          {options && (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={tagCreateOpen}
              onClick={() => setTagCreateOpen((open) => !open)}
            >
              <Plus size={15} /> Створити тег
            </Button>
          )}
        </div>
        {optionsLoading && !options && (
          <p className="task-create-local-state" role="status">Завантажуємо доступні теги…</p>
        )}
        {optionsError && !options && (
          <div className="task-create-local-error">
            <span>Не вдалося завантажити теги.</span>
            <button type="button" onClick={onRetryOptions}>Повторити</button>
          </div>
        )}
        {options && (
          <>
            {options.tags.length > 0 ? (
              <div className="task-create-chips" aria-label="Теги завдання">
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
            ) : (
              <p className="task-create-help">Доступних тегів поки немає.</p>
            )}
            {tagCreateOpen && (
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
            )}
            {tagMutation.isError && <p className="form-error">Не вдалося створити тег.</p>}
          </>
        )}
      </section>

      <section className="task-create-subgroup" aria-labelledby="task-create-context-files-title">
        <div className="task-create-subgroup__heading">
          <div>
            <h4 id="task-create-context-files-title">Вкладення</h4>
            <p>До 10 файлів; перевірка починається одразу після вибору.</p>
          </div>
          <label className="button button--secondary task-create-file-picker">
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
        </div>
        {upload.isError && <p className="form-error">Не вдалося підготувати файл.</p>}
        {draft.attachments.length > 0 ? (
          <ul className="task-create-attachments">
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
        ) : (
          <p className="task-create-help">Файлів ще немає.</p>
        )}
      </section>
    </div>
  )
}
