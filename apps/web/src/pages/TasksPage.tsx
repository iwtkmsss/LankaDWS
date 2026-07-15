import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PageResult, TaskListItem } from '@bert-crm/contracts'
import {
  Bookmark,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Filter,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import {
  Avatar,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
} from '../shared/ui'

interface Employee {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset?: string | null
}
interface TaskDetail extends TaskListItem {
  description: string
  creator: Employee
  checklist: Array<{
    id: string
    text: string
    isDone: boolean
    version: number
  }>
  comments: Array<{
    id: string
    authorId: string
    body: string
    createdAt: string
  }>
}

export default function TasksPage() {
  const { taskId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(params.get('search') || params.get('status') || params.get('priority')),
  )
  const segment = params.get('tab') ?? 'mine'
  const page = Number(params.get('page') ?? 1)
  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const priority = params.get('priority') ?? ''
  const [viewName, setViewName] = useState('')
  const savedViews = useQuery({
    queryKey: ['saved-views', 'TASKS'],
    queryFn: () => api<Array<{ id: string; module: string; name: string; queryState: string }>>('/saved-views'),
    enabled: filtersOpen,
  })
  const saveView = useMutation({
    mutationFn: (name: string) =>
      api('/saved-views', {
        method: 'POST',
        body: jsonBody({
          module: 'TASKS',
          name,
          queryState: Object.fromEntries(params.entries()),
        }),
      }),
    onSuccess: () => {
      setViewName('')
      void savedViews.refetch()
    },
  })
  const queryString = new URLSearchParams({
    segment,
    page: String(page),
    company: params.get('company') ?? '',
    search,
    status,
    priority,
  })
  const query = useQuery({
    queryKey: ['tasks', segment, page, params.get('company'), search, status, priority],
    queryFn: () => api<PageResult<TaskListItem>>(`/tasks?${queryString.toString()}`),
  })
  if (location.pathname === '/tasks/new')
    return <TaskCreate onDone={(id) => navigate(`/tasks/${id}`, { replace: true })} />
  return (
    <div>
      <PageHeader
        title="Завдання"
        description="Особисті, створені вами та доступні командні задачі"
        action={
          can('tasks.create') && (
            <Link className="button button--primary" to={`/tasks/new${location.search}`}>
              <Plus size={17} />
              Нове завдання
            </Link>
          )
        }
      />
      <Card className="list-card">
        <div className="list-toolbar">
          <Tabs
            value={segment}
            onChange={(value) =>
              setParams((current) => {
                current.set('tab', value)
                current.delete('page')
                return current
              })
            }
            items={[
              { value: 'mine', label: 'Мої', count: query.data?.total },
              { value: 'created', label: 'Створені мною' },
              ...(can('tasks.manage') ? [{ value: 'all', label: 'Усі доступні' }] : []),
            ]}
          />
          <div className="toolbar-actions">
            <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
              <Search size={17} />
              Пошук
            </button>
            <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
              <Filter size={17} />
              Фільтри
              {[search, status, priority].filter(Boolean).length
                ? ` · ${[search, status, priority].filter(Boolean).length}`
                : ''}
            </button>
          </div>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Пошук завдань"
                autoFocus
                placeholder="Назва або номер"
                value={search}
                onChange={(event) =>
                  setParams((current) => {
                    if (event.target.value) current.set('search', event.target.value)
                    else current.delete('search')
                    current.delete('page')
                    return current
                  })
                }
              />
            </label>
            <label>
              Статус
              <select
                value={status}
                onChange={(event) =>
                  setParams((current) => {
                    if (event.target.value) current.set('status', event.target.value)
                    else current.delete('status')
                    current.delete('page')
                    return current
                  })
                }
              >
                <option value="">Усі</option>
                <option value="NEW">Нове</option>
                <option value="PLANNED">Заплановано</option>
                <option value="IN_PROGRESS">В роботі</option>
                <option value="IN_REVIEW">На перевірці</option>
                <option value="DONE">Виконано</option>
                <option value="BLOCKED">Заблоковано</option>
              </select>
            </label>
            <label>
              Пріоритет
              <select
                value={priority}
                onChange={(event) =>
                  setParams((current) => {
                    if (event.target.value) current.set('priority', event.target.value)
                    else current.delete('priority')
                    current.delete('page')
                    return current
                  })
                }
              >
                <option value="">Усі</option>
                <option value="LOW">Низький</option>
                <option value="MEDIUM">Середній</option>
                <option value="HIGH">Високий</option>
                <option value="CRITICAL">Критичний</option>
              </select>
            </label>
            <label>
              Збережений вигляд
              <select
                defaultValue=""
                onChange={(event) => {
                  const view = savedViews.data?.find((item) => item.id === event.target.value)
                  if (view) setParams(JSON.parse(view.queryState) as Record<string, string>)
                }}
              >
                <option value="">Оберіть</option>
                {savedViews.data
                  ?.filter((item) => item.module === 'TASKS')
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="save-view">
              <input
                aria-label="Назва вигляду"
                value={viewName}
                maxLength={80}
                onChange={(event) => setViewName(event.target.value)}
                placeholder="Назва вигляду"
              />
              <Button
                variant="secondary"
                disabled={!viewName.trim() || saveView.isPending}
                onClick={() => saveView.mutate(viewName.trim())}
              >
                <Bookmark size={15} />
                Зберегти
              </Button>
            </div>
            {(search || status || priority) && (
              <Button
                variant="ghost"
                onClick={() =>
                  setParams((current) => {
                    current.delete('search')
                    current.delete('status')
                    current.delete('priority')
                    current.delete('page')
                    return current
                  })
                }
              >
                Очистити
              </Button>
            )}
          </div>
        )}
        {query.isLoading ? (
          <Skeleton rows={7} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Завдання</th>
                  <th>Виконавець</th>
                  <th>Строк</th>
                  <th>Статус</th>
                  <th aria-label="Активність" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link to={`/tasks/${task.id}${location.search}`}>
                        <span className={`priority-dot priority-dot--${task.priority.toLowerCase()}`} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.number}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="person-cell">
                        <Avatar size="sm" name={task.assignee.displayName} src={task.assignee.avatarAsset} />
                        {task.assignee.displayName}
                      </span>
                    </td>
                    <td>{task.deadline ? formatDate(task.deadline) : '—'}</td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                    <td>
                      <span className="activity-count">
                        <MessageCircle size={14} />
                        {task.commentCount}
                        <Paperclip size={14} />
                        {task.attachmentCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Тут поки порожньо"
            description="Змініть вкладку чи створіть перше завдання."
            action={
              can('tasks.create') && (
                <Link className="button button--primary" to="/tasks/new">
                  Створити завдання
                </Link>
              )
            }
          />
        )}
        {query.data && query.data.total > query.data.pageSize && (
          <footer className="pagination">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() =>
                setParams((current) => {
                  current.set('page', String(page - 1))
                  return current
                })
              }
            >
              Назад
            </Button>
            <span>Сторінка {page}</span>
            <Button
              variant="secondary"
              disabled={page * query.data.pageSize >= query.data.total}
              onClick={() =>
                setParams((current) => {
                  current.set('page', String(page + 1))
                  return current
                })
              }
            >
              Далі
            </Button>
          </footer>
        )}
      </Card>
      {taskId && <TaskDrawer id={taskId} onClose={() => navigate(`/tasks${location.search}`)} />}
    </div>
  )
}

function TaskCreate({ onDone }: { onDone: (id: string) => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const employees = useQuery({
    queryKey: ['employees', 'task-form'],
    queryFn: () => api<{ items: Employee[] }>('/employees'),
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const selectedCompany = params.get('company')
    try {
      const result = await api<{ id: string }>('/tasks', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey('task') },
        body: jsonBody({
          title: form.get('title'),
          description: form.get('description'),
          assigneeId: form.get('assigneeId'),
          deadline: form.get('deadline') || undefined,
          priority: form.get('priority'),
          companyId: selectedCompany && selectedCompany !== 'all' ? selectedCompany : user?.primaryCompanyId,
        }),
      })
      onDone(result.id)
    } catch {
      setError('Не вдалося створити завдання. Перевірте поля та доступ виконавця.')
    }
  }
  return (
    <>
      <PageHeader title="Нове завдання" description="Після створення завдання одразу стане доступне виконавцю" />
      <Card className="form-card">
        <form onSubmit={submit} className="entity-form">
          <label className="span-2">
            Назва
            <input name="title" maxLength={180} required autoFocus placeholder="Що потрібно зробити?" />
          </label>
          <label>
            Виконавець
            <select name="assigneeId" required defaultValue="">
              <option value="" disabled>
                Оберіть людину
              </option>
              {employees.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Пріоритет
            <select name="priority" defaultValue="MEDIUM">
              <option value="LOW">Низький</option>
              <option value="MEDIUM">Середній</option>
              <option value="HIGH">Високий</option>
              <option value="CRITICAL">Критичний</option>
            </select>
          </label>
          <label>
            Строк
            <input type="datetime-local" name="deadline" />
          </label>
          <label className="span-2">
            Опис
            <textarea name="description" rows={6} placeholder="Контекст, очікуваний результат і критерії готовності" />
          </label>
          {error && <div className="form-error span-2">{error}</div>}
          <div className="form-actions span-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/tasks')}>
              Скасувати
            </Button>
            <Button>
              <CirclePlus size={17} />
              Створити
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}

function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient()
  const [comment, setComment] = useState('')
  const [newItem, setNewItem] = useState('')
  const [recurrenceMessage, setRecurrenceMessage] = useState('')
  const query = useQuery({
    queryKey: ['task', id],
    queryFn: () => api<TaskDetail>(`/tasks/${id}`),
  })
  const status = useMutation({
    mutationFn: (input: { status: string; expectedVersion: number }) =>
      api(`/tasks/${id}/status`, { method: 'PATCH', body: jsonBody(input) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const post = useMutation({
    mutationFn: (body: string) =>
      api(`/tasks/${id}/comments`, {
        method: 'POST',
        body: jsonBody({ body }),
      }),
    onSuccess: () => {
      setComment('')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  const addItem = useMutation({
    mutationFn: (text: string) =>
      api(`/tasks/${id}/checklist`, {
        method: 'POST',
        body: jsonBody({ text }),
      }),
    onSuccess: () => {
      setNewItem('')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  const updateItem = useMutation({
    mutationFn: (item: { id: string; isDone: boolean; version: number }) =>
      api(`/tasks/${id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: jsonBody({ isDone: item.isDone, expectedVersion: item.version }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['task', id] }),
  })
  const recurrence = useMutation({
    mutationFn: (input: { frequency: string; interval: number; firstOccurrenceAt: string; until?: string }) =>
      api<{ nextOccurrenceAt: string }>(`/tasks/${id}/recurrence`, {
        method: 'POST',
        body: jsonBody(input),
      }),
    onSuccess: (result) =>
      setRecurrenceMessage(`Наступне завдання заплановано на ${formatDateTime(result.nextOccurrenceAt)}`),
  })
  return (
    <Drawer
      title={query.data?.number ?? 'Завдання'}
      onClose={onClose}
      footer={
        query.data && (
          <div className="drawer-actions">
            <select
              aria-label="Змінити статус"
              value={query.data.status}
              onChange={(event) =>
                status.mutate({
                  status: event.target.value,
                  expectedVersion: query.data.version,
                })
              }
            >
              <option value="NEW">Нове</option>
              <option value="IN_PROGRESS">В роботі</option>
              <option value="IN_REVIEW">На перевірці</option>
              <option value="DONE">Виконано</option>
              <option value="BLOCKED">Заблоковано</option>
            </select>
          </div>
        )
      }
    >
      {query.isLoading ? (
        <Skeleton rows={6} />
      ) : query.isError || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <div className="detail-stack">
          <div>
            <StatusBadge status={query.data.status} />
            <h3>{query.data.title}</h3>
            <p>{query.data.description || 'Опис не додано.'}</p>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Виконавець</dt>
              <dd>
                <Avatar size="sm" name={query.data.assignee.displayName} />
                {query.data.assignee.displayName}
              </dd>
            </div>
            <div>
              <dt>Строк</dt>
              <dd>{query.data.deadline ? formatDateTime(query.data.deadline) : 'Без строку'}</dd>
            </div>
            <div>
              <dt>Пріоритет</dt>
              <dd>{query.data.priority}</dd>
            </div>
            <div>
              <dt>Автор</dt>
              <dd>{query.data.creator?.displayName}</dd>
            </div>
          </dl>
          <section>
            <h4>Checklist</h4>
            {query.data.checklist?.length ? (
              <div className="checklist">
                {query.data.checklist.map((item) => (
                  <label className="checklist-row" key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.isDone}
                      onChange={() =>
                        updateItem.mutate({
                          id: item.id,
                          isDone: !item.isDone,
                          version: item.version,
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
          </section>
          <section>
            <details>
              <summary>Повторення завдання</summary>
              <form
                className="recurrence-form"
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
                  <input name="firstOccurrenceAt" type="datetime-local" required />
                </label>
                <label>
                  До дати
                  <input name="until" type="datetime-local" />
                </label>
                <Button variant="secondary" disabled={recurrence.isPending}>
                  Запланувати
                </Button>
                {recurrenceMessage && <p className="success-note">{recurrenceMessage}</p>}
              </form>
            </details>
          </section>
          <section>
            <h4>Обговорення</h4>
            <div className="comments">
              {query.data.comments?.map((item) => (
                <article key={item.id}>
                  <strong>{item.authorId}</strong>
                  <p>{item.body}</p>
                  <small>{formatDateTime(item.createdAt)}</small>
                </article>
              ))}
            </div>
            <form
              className="comment-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (comment.trim()) post.mutate(comment)
              }}
            >
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                placeholder="Додати коментар"
              />
              <Button disabled={post.isPending}>
                Надіслати <ChevronRight size={16} />
              </Button>
            </form>
          </section>
        </div>
      )}
    </Drawer>
  )
}
