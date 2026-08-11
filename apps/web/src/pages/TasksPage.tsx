import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  GroupListResult,
  PageResult,
  StructuredMentionInput,
  TaskActivityPage,
  TaskAttachmentView,
  TaskDetailView,
  TaskListItem,
  TaskParticipantRole,
  TaskViewRole,
} from '@bert-crm/contracts'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Download,
  Eye,
  FileText,
  Flag,
  History,
  Link2,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiProblem, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { TaskCreateModal } from '../features/tasks/create/TaskCreateModal'
import { TaskListColumnsControl, useTaskListColumnsPreference } from '../features/tasks/list/TaskListColumns'
import {
  TaskDetailCustomization,
  TaskDetailSection,
  TaskDetailSections,
  useTaskDetailPreference,
} from '../features/tasks/detail/TaskDetailPreferences'
import { MentionText } from '../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../shared/mentions/mentionText'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface Employee {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset?: string | null
}

export default function TasksPage() {
  const { taskId } = useParams()
  return taskId ? <TaskDetailPage id={taskId} /> : <TasksListPage />
}

function TasksListPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const pendingParams = useRef(new URLSearchParams(params))
  useEffect(() => {
    pendingParams.current = new URLSearchParams(params)
  }, [params])
  const updateParams = (update: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(pendingParams.current)
    update(next)
    pendingParams.current = next
    setParams(next)
  }
  const replaceParams = (next: URLSearchParams) => {
    pendingParams.current = next
    setParams(next)
  }
  const { user } = useAuth()
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(
      params.get('search')
      || params.get('status')
      || params.get('priority')
      || params.get('favorite')
      || params.get('important')
      || params.get('overdue')
      || params.get('preset')
      || params.get('dueFrom')
      || params.get('dueTo')
      || params.get('groupId')
      || params.get('assigneeId')
      || params.get('creatorId')
      || params.get('coExecutorId')
      || params.get('observerId'),
    ),
  )
  const legacyTab = params.get('tab')
  const role = (params.get('role')
    ?? (legacyTab === 'created' ? 'CREATOR' : legacyTab === 'all' ? 'ALL' : 'RESPONSIBLE')) as TaskViewRole
  const page = Number(params.get('page') ?? 1)
  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const priority = params.get('priority') ?? ''
  const favorite = params.get('favorite') ?? ''
  const important = params.get('important') ?? ''
  const overdue = params.get('overdue') === 'true'
  const preset = params.get('preset') ?? (overdue ? 'OVERDUE' : '')
  const dueFrom = params.get('dueFrom') ?? ''
  const dueTo = params.get('dueTo') ?? ''
  const groupId = params.get('groupId') ?? ''
  const assigneeId = params.get('assigneeId') ?? ''
  const creatorId = params.get('creatorId') ?? ''
  const coExecutorId = params.get('coExecutorId') ?? ''
  const observerId = params.get('observerId') ?? ''
  const personalFilter = favorite === 'true'
    ? 'favorite'
    : important === 'true'
      ? 'important'
      : ''
  const [viewName, setViewName] = useState('')
  const savedViews = useQuery({
    queryKey: ['saved-views', 'TASKS'],
    queryFn: () => api<Array<{ id: string; module: string; name: string; queryState: string }>>('/saved-views'),
    enabled: filtersOpen,
  })
  const filterEmployees = useQuery({
    queryKey: ['task-filter-employees'],
    queryFn: () => api<{ items: Employee[] }>('/employees'),
    enabled: filtersOpen,
  })
  const filterGroups = useQuery({
    queryKey: ['task-filter-groups', params.get('company')],
    queryFn: () => api<GroupListResult>(
      `/groups?limit=50${params.get('company') ? `&company=${encodeURIComponent(params.get('company')!)}` : ''}`,
    ),
    enabled: filtersOpen,
    retry: false,
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
    role,
    page: String(page),
    company: params.get('company') ?? '',
    search,
    status,
    priority,
    favorite,
    important,
    overdue: overdue ? 'true' : '',
    preset,
    dueFrom,
    dueTo,
    groupId,
    assigneeId,
    creatorId,
    coExecutorId,
    observerId,
  })
  const query = useQuery({
    queryKey: [
      'tasks',
      role,
      page,
      params.get('company'),
      search,
      status,
      priority,
      favorite,
      important,
      overdue,
      preset,
      dueFrom,
      dueTo,
      groupId,
      assigneeId,
      creatorId,
      coExecutorId,
      observerId,
    ],
    queryFn: () => api<PageResult<TaskListItem>>(`/tasks?${queryString.toString()}`),
  })
  const quickComplete = useMutation({
    mutationFn: (task: TaskListItem) =>
      api(`/tasks/${task.id}/status`, {
        method: 'PATCH',
        body: jsonBody({ status: 'DONE', expectedVersion: task.version }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const canQuickComplete = role === 'RESPONSIBLE'
    || role === 'CO_EXECUTOR'
    || (role === 'ALL' && user?.accountType === 'ADMIN')
  const isCreating = location.pathname === '/tasks/new'
  const taskListColumns = useTaskListColumnsPreference()
  return (
    <div>
      <PageHeader
        title="Завдання"
        description="Окремі робочі списки за вашою роллю в кожному завданні"
        action={
          (
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
            value={role}
            onChange={(value) =>
              updateParams((current) => {
                current.set('role', value)
                current.delete('tab')
                current.delete('page')
              })
            }
            items={[
              { value: 'RESPONSIBLE', label: 'Мої', count: role === 'RESPONSIBLE' ? query.data?.total : undefined },
              { value: 'CO_EXECUTOR', label: 'Допомагаю', count: role === 'CO_EXECUTOR' ? query.data?.total : undefined },
              { value: 'CREATOR', label: 'Доручив', count: role === 'CREATOR' ? query.data?.total : undefined },
              { value: 'OBSERVER', label: 'Спостерігаю', count: role === 'OBSERVER' ? query.data?.total : undefined },
              ...(user?.accountType === 'ADMIN' ? [{ value: 'ALL', label: 'Усі доступні', count: role === 'ALL' ? query.data?.total : undefined }] : []),
            ]}
          />
          <div className="toolbar-actions">
            <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
              <Search size={17} />
              Пошук і фільтри
              {[search, status, priority, personalFilter, preset, dueFrom, dueTo, groupId, assigneeId, creatorId, coExecutorId, observerId].filter(Boolean).length
                ? ` · ${[search, status, priority, personalFilter, preset, dueFrom, dueTo, groupId, assigneeId, creatorId, coExecutorId, observerId].filter(Boolean).length}`
                : ''}
            </button>
            <TaskListColumnsControl controller={taskListColumns} />
          </div>
        </div>
        <div className="task-presets" aria-label="Швидкі режими завдань">
          {[
            ['ACTIVE', 'В роботі'],
            ['DEFERRED', 'Відкладені'],
            ['OVERDUE', 'Прострочені'],
            ['DUE_SOON', 'Скоро строк'],
          ].map(([value, label]) => (
            <button
              type="button"
              className={preset === value ? 'is-active' : ''}
              key={value}
              onClick={() => updateParams((current) => {
                current.delete('overdue')
                if (preset === value) current.delete('preset')
                else current.set('preset', value)
                current.delete('page')
              })}
            >
              {label}
            </button>
          ))}
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
                  updateParams((current) => {
                    if (event.target.value) current.set('search', event.target.value)
                    else current.delete('search')
                    current.delete('page')
                  })
                }
              />
            </label>
            <label>
              Статус
              <select
                value={status}
                onChange={(event) =>
                  updateParams((current) => {
                    if (event.target.value) current.set('status', event.target.value)
                    else current.delete('status')
                    current.delete('page')
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
                  updateParams((current) => {
                    if (event.target.value) current.set('priority', event.target.value)
                    else current.delete('priority')
                    current.delete('page')
                  })
                }
              >
                <option value="">Усі</option>
                <option value="LOW">Низький</option>
                <option value="MEDIUM">Середній</option>
                <option value="HIGH">Високий</option>
                <option value="CRITICAL">Терміновий</option>
              </select>
            </label>
            <label>
              Особисте
              <select
                value={personalFilter}
                onChange={(event) =>
                  updateParams((current) => {
                    current.delete('favorite')
                    current.delete('important')
                    if (event.target.value === 'favorite') current.set('favorite', 'true')
                    if (event.target.value === 'important') current.set('important', 'true')
                    current.delete('page')
                  })
                }
              >
                <option value="">Усі</option>
                <option value="favorite">Обрані</option>
                <option value="important">Важливі для мене</option>
              </select>
            </label>
            <label>
              Строк
              <select
                value={preset}
                onChange={(event) =>
                  updateParams((current) => {
                    current.delete('overdue')
                    if (event.target.value) current.set('preset', event.target.value)
                    else current.delete('preset')
                    current.delete('page')
                  })
                }
              >
                <option value="">Усі</option>
                <option value="ACTIVE">В роботі</option>
                <option value="DEFERRED">Відкладені</option>
                <option value="OVERDUE">Прострочені</option>
                <option value="DUE_SOON">Скоро строк</option>
              </select>
            </label>
            <label>
              Від дати
              <input
                type="date"
                value={dueFrom}
                onChange={(event) => updateParams((current) => {
                  if (event.target.value) current.set('dueFrom', event.target.value)
                  else current.delete('dueFrom')
                  current.delete('page')
                })}
              />
            </label>
            <label>
              До дати
              <input
                type="date"
                value={dueTo}
                onChange={(event) => updateParams((current) => {
                  if (event.target.value) current.set('dueTo', event.target.value)
                  else current.delete('dueTo')
                  current.delete('page')
                })}
              />
            </label>
            <TaskFilterSelect
              label="Група"
              value={groupId}
              options={(filterGroups.data?.items ?? []).map((group) => ({ id: group.id, label: group.name }))}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('groupId', value)
                else current.delete('groupId')
                current.delete('page')
              })}
            />
            <TaskFilterSelect
              label="Відповідальний"
              value={assigneeId}
              options={(filterEmployees.data?.items ?? []).map((employee) => ({ id: employee.id, label: employee.displayName }))}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('assigneeId', value)
                else current.delete('assigneeId')
                current.delete('page')
              })}
            />
            <TaskFilterSelect
              label="Постановник"
              value={creatorId}
              options={(filterEmployees.data?.items ?? []).map((employee) => ({ id: employee.id, label: employee.displayName }))}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('creatorId', value)
                else current.delete('creatorId')
                current.delete('page')
              })}
            />
            <TaskFilterSelect
              label="Співвиконавець"
              value={coExecutorId}
              options={(filterEmployees.data?.items ?? []).map((employee) => ({ id: employee.id, label: employee.displayName }))}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('coExecutorId', value)
                else current.delete('coExecutorId')
                current.delete('page')
              })}
            />
            <TaskFilterSelect
              label="Спостерігач"
              value={observerId}
              options={(filterEmployees.data?.items ?? []).map((employee) => ({ id: employee.id, label: employee.displayName }))}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('observerId', value)
                else current.delete('observerId')
                current.delete('page')
              })}
            />
            <label>
              Збережений вигляд
              <select
                defaultValue=""
                onChange={(event) => {
                  const view = savedViews.data?.find((item) => item.id === event.target.value)
                  if (view) replaceParams(new URLSearchParams(JSON.parse(view.queryState) as Record<string, string>))
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
            {(search || status || priority || personalFilter || preset || dueFrom || dueTo || groupId || assigneeId || creatorId || coExecutorId || observerId) && (
              <Button
                variant="ghost"
                onClick={() =>
                  updateParams((current) => {
                    current.delete('search')
                    current.delete('status')
                    current.delete('priority')
                    current.delete('favorite')
                    current.delete('important')
                    current.delete('overdue')
                    current.delete('preset')
                    current.delete('dueFrom')
                    current.delete('dueTo')
                    current.delete('groupId')
                    current.delete('assigneeId')
                    current.delete('creatorId')
                    current.delete('coExecutorId')
                    current.delete('observerId')
                    current.delete('page')
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
          <div className="responsive-table task-list-table-wrap">
            <table className="task-list-table">
              <thead>
                <tr>
                  <th>Завдання</th>
                  {taskListColumns.visible.includes('responsibles') && <th>Виконавці</th>}
                  {taskListColumns.visible.includes('dueDate') && <th>Строк</th>}
                  {taskListColumns.visible.includes('status') && <th>Статус</th>}
                  {taskListColumns.visible.includes('reporter') && <th>Постановник</th>}
                  {taskListColumns.visible.includes('group') && <th>Група</th>}
                  {taskListColumns.visible.includes('priority') && <th>Пріоритет</th>}
                  {taskListColumns.visible.includes('subtaskProgress') && <th>Підзадачі</th>}
                  {taskListColumns.visible.includes('activity') && <th>Активність</th>}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((task) => (
                  <tr key={task.id}>
                    <td data-label="Завдання">
                      <Link to={`/tasks/${task.id}${location.search}`}>
                        <span className={`priority-dot priority-dot--${task.priority.toLowerCase()}`} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>
                            {task.number}
                            {task.parentTaskId ? ' · Підзадача' : ''}
                          </small>
                        </span>
                      </Link>
                      <span className="task-row-actions">
                        {canQuickComplete && !['DONE', 'CANCELLED', 'ARCHIVED'].includes(task.status) && (
                          <button
                            type="button"
                            className="task-quick-complete"
                            aria-label={`Завершити «${task.title}»`}
                            title="Завершити завдання"
                            disabled={quickComplete.isPending && quickComplete.variables?.id === task.id}
                            onClick={() => quickComplete.mutate(task)}
                          >
                            <CheckCircle2 size={17} />
                          </button>
                        )}
                        {quickComplete.isError && quickComplete.variables?.id === task.id && (
                          <Link className="task-quick-complete-error" to={`/tasks/${task.id}${location.search}`}>
                            Потрібна увага
                          </Link>
                        )}
                      </span>
                    </td>
                    {taskListColumns.visible.includes('responsibles') && <td data-label="Виконавці">
                      {task.responsibles.length ? (
                        <span className="person-cell task-responsibles">
                          {task.responsibles.map((responsible) => (
                            <span key={responsible.id}>
                              <Avatar size="sm" name={responsible.displayName} src={responsible.avatarAsset} />
                              {responsible.displayName}
                            </span>
                          ))}
                        </span>
                      ) : '—'}
                    </td>}
                    {taskListColumns.visible.includes('dueDate') && <td data-label="Строк">
                      {task.deadline ? (
                        <span className={`task-deadline ${isTaskOverdue(task) ? 'is-overdue' : ''}`}>
                          {isTaskOverdue(task) && <AlertTriangle size={14} />}
                          <span>
                            {formatDate(task.deadline)}
                            {isTaskOverdue(task) && <small>Прострочено</small>}
                          </span>
                        </span>
                      ) : '—'}
                    </td>}
                    {taskListColumns.visible.includes('status') && <td data-label="Статус"><StatusBadge status={task.status} /></td>}
                    {taskListColumns.visible.includes('reporter') && <td data-label="Постановник"><span className="person-cell"><Avatar size="sm" name={task.reporter.displayName} src={task.reporter.avatarAsset} />{task.reporter.displayName}</span></td>}
                    {taskListColumns.visible.includes('group') && <td data-label="Група">{task.group?.name ?? '—'}</td>}
                    {taskListColumns.visible.includes('priority') && <td data-label="Пріоритет">{taskPriorityLabel(task.priority)}</td>}
                    {taskListColumns.visible.includes('subtaskProgress') && <td data-label="Підзадачі">{task.subtaskProgress.total ? `${task.subtaskProgress.done}/${task.subtaskProgress.total}` : '—'}</td>}
                    {taskListColumns.visible.includes('activity') && <td data-label="Активність">
                      <span className="activity-count">
                          <MessageCircle size={14} />
                          {task.commentCount}
                          <Paperclip size={14} />
                          {task.attachmentCount}
                      </span>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={taskRoleEmptyState(role).title}
            description={taskRoleEmptyState(role).description}
            action={
              (
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
                updateParams((current) => {
                  current.set('page', String(page - 1))
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
                updateParams((current) => {
                  current.set('page', String(page + 1))
                })
              }
            >
              Далі
            </Button>
          </footer>
        )}
      </Card>
      {isCreating && (
        <TaskCreateModal
          groupId={params.get('groupId') ?? ''}
          initialResponsibleId={params.get('assigneeId') ?? ''}
          onClose={() => navigate(`/tasks${location.search}`, { replace: true })}
          onDone={(id) => navigate(`/tasks/${id}`, { replace: true })}
        />
      )}
    </div>
  )
}

function TaskDetailPage({ id }: { id: string }) {
  const location = useLocation()
  const navigate = useNavigate()

  return <TaskDetailSurface id={id} onBack={() => navigate(`/tasks${location.search}`)} />
}

function TaskDetailSurface({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient()
  const location = useLocation()
  const { user } = useAuth()
  const [comment, setComment] = useState('')
  const [commentMentions, setCommentMentions] = useState<StructuredMentionInput[]>([])
  const commentAttemptRef = useRef({ signature: '', key: '' })
  const [replyTo, setReplyTo] = useState<{
    id: string
    authorName: string
    body: string
  } | null>(null)
  const [commentAttachmentIds, setCommentAttachmentIds] = useState<string[]>([])
  const [contentMessage, setContentMessage] = useState('')
  const [newItem, setNewItem] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false)
  const [subtaskError, setSubtaskError] = useState('')
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [participantMessage, setParticipantMessage] = useState('')
  const [statusError, setStatusError] = useState('')
  const [recurrenceMessage, setRecurrenceMessage] = useState('')
  const [personalMessage, setPersonalMessage] = useState('')
  const [activityOpen, setActivityOpen] = useState(false)
  const [dirtyForms, setDirtyForms] = useState<string[]>([])
  const markDirty = (form: string) => {
    setDirtyForms((current) => current.includes(form) ? current : [...current, form])
  }
  const clearDirty = (form: string) => {
    setDirtyForms((current) => current.filter((item) => item !== form))
  }
  const closeGuard = useModalCloseGuard({
    dirty: Boolean(
      dirtyForms.length
      || comment.trim()
      || replyTo
      || commentAttachmentIds.length
      || newItem.trim(),
    ),
    onRequestClose: onBack,
  })
  const statusErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!statusError || !statusErrorRef.current) return
    statusErrorRef.current.scrollIntoView({ block: 'center' })
    statusErrorRef.current.focus({ preventScroll: true })
  }, [statusError])
  const query = useQuery({
    queryKey: ['task', id],
    queryFn: () => api<TaskDetailView>(`/tasks/${id}`),
  })
  const detailPreference = useTaskDetailPreference()
  const employees = useQuery({
    queryKey: ['employees', 'task-form'],
    queryFn: () => api<{ items: Employee[] }>('/employees'),
    enabled: editOpen || subtaskFormOpen || participantsOpen,
  })
  const activity = useInfiniteQuery({
    queryKey: ['task-activity', id],
    queryFn: ({ pageParam }) =>
      api<TaskActivityPage>(
        `/tasks/${id}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: activityOpen,
  })
  useEffect(() => {
    setActivityOpen(
      !detailPreference.value.hidden.includes('history')
      && !detailPreference.value.collapsed.includes('history'),
    )
  }, [detailPreference.value.collapsed, detailPreference.value.hidden])
  const updateTask = useMutation({
    mutationFn: (input: {
      title: string
      description: string
      assigneeId: string
      creatorId?: string
      deadline: string | null
      priority: string
      blockReason: string | null
      expectedVersion: number
    }) => api<{ version: number }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    }),
    onSuccess: () => {
      setEditMessage('')
      clearDirty('edit')
      setEditOpen(false)
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setEditMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Завдання вже змінилося. Оновіть його та повторіть редагування.'
          : 'Не вдалося зберегти зміни. Перевірте поля й доступ відповідального.',
      )
    },
  })
  const setUserState = useMutation({
    mutationFn: (input: { favorited?: boolean; important?: boolean }) =>
      api(`/tasks/${id}/user-state`, {
        method: 'PUT',
        headers: { 'idempotency-key': idempotencyKey('task-state') },
        body: jsonBody(input),
      }),
    onSuccess: () => {
      setPersonalMessage('Особисті позначки оновлено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setPersonalMessage('Не вдалося оновити особисті позначки.'),
  })
  const follow = useMutation({
    mutationFn: (following: boolean) => {
      if (!user) throw new Error('principal_missing')
      return following
        ? api(`/tasks/${id}/followers`, {
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey('task-follow') },
            body: jsonBody({}),
          })
        : api(`/tasks/${id}/followers/${encodeURIComponent(user.id)}`, {
            method: 'DELETE',
          })
    },
    onSuccess: (_result, following) => {
      setPersonalMessage(following ? 'Ви стежите за новими коментарями.' : 'Стеження вимкнено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setPersonalMessage('Не вдалося змінити стеження.'),
  })
  const createReminder = useMutation({
    mutationFn: (remindAt: string) => {
      if (!query.data || !user) throw new Error('task_reminder_context')
      return api(`/tasks/${id}/reminders`, {
        method: 'POST',
        body: jsonBody({
          reminder: {
            target: { type: 'USER', userId: user.id },
            trigger: { type: 'AT', at: remindAt },
          },
          expectedVersion: query.data.version,
        }),
      })
    },
    onSuccess: () => {
      setPersonalMessage('Нагадування заплановано.')
      clearDirty('reminder')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setPersonalMessage('Оберіть майбутні дату й час для нагадування.'),
  })
  const cancelReminder = useMutation({
    mutationFn: (reminderId: string) =>
      api(`/tasks/${id}/reminders/${encodeURIComponent(reminderId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setPersonalMessage('Нагадування скасовано.')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: () => setPersonalMessage('Не вдалося скасувати нагадування.'),
  })
  const status = useMutation({
    mutationFn: (input: { status: string; expectedVersion: number }) =>
      api(`/tasks/${id}/status`, { method: 'PATCH', body: jsonBody(input) }),
    onSuccess: () => {
      setStatusError('')
      void client.invalidateQueries({ queryKey: ['task', id] })
      if (query.data?.parentTaskId) {
        void client.invalidateQueries({ queryKey: ['task', query.data.parentTaskId] })
      }
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setStatusError(
        error instanceof ApiProblem && error.problem.code === 'task_completion_blocked'
          ? error.problem.detail ?? 'Спочатку завершіть активні підзадачі.'
          : 'Не вдалося змінити статус. Оновіть завдання та спробуйте ще раз.',
      )
    },
  })
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
          : 'Не вдалося додати підзадачу. Перевірте поля та доступ виконавця.',
      )
    },
  })
  const uploadAttachment = useMutation({
    mutationFn: async (input: { file: File; selectForComment: boolean }) => {
      const body = new FormData()
      body.append('file', input.file)
      return api<TaskAttachmentView>(`/tasks/${id}/attachments`, {
        method: 'POST',
        body,
      })
    },
    onSuccess: (attachment, input) => {
      setContentMessage('Файл додано. Він відкриється після безпечної перевірки.')
      if (input.selectForComment) {
        setCommentAttachmentIds((current) => (
          current.includes(attachment.id)
            ? current
            : [...current, attachment.id].slice(0, 5)
        ))
      }
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: () => setContentMessage('Не вдалося додати файл. Перевірте формат, розмір або ліміт.'),
  })
  const removeAttachment = useMutation({
    mutationFn: (fileId: string) =>
      api(`/tasks/${id}/attachments/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_result, fileId) => {
      setContentMessage('Файл вилучено із завдання та коментарів.')
      setCommentAttachmentIds((current) => current.filter((idValue) => idValue !== fileId))
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: () => setContentMessage('Не вдалося вилучити файл. Оновіть завдання й спробуйте ще раз.'),
  })
  const post = useMutation({
    mutationFn: (input: {
      body: string
      replyToCommentId: string | null
      attachmentIds: string[]
      mentions: StructuredMentionInput[]
      key: string
    }) => {
      const { key, ...body } = input
      return api(`/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: jsonBody(body),
      })
    },
    onSuccess: () => {
      setComment('')
      setCommentMentions([])
      commentAttemptRef.current = { signature: '', key: '' }
      setReplyTo(null)
      setCommentAttachmentIds([])
      setContentMessage('')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: () => setContentMessage('Не вдалося надіслати коментар. Перевірте текст і вкладення.'),
  })
  const addItem = useMutation({
    mutationFn: (text: string) => {
      if (!query.data) throw new Error('task_checklist_context')
      return api(`/tasks/${id}/checklist`, {
        method: 'POST',
        body: jsonBody({ title: text, expectedVersion: query.data.version }),
      })
    },
    onSuccess: () => {
      setNewItem('')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  const updateItem = useMutation({
    mutationFn: (item: { id: string; isDone: boolean }) => {
      if (!query.data) throw new Error('task_checklist_context')
      return api(`/tasks/${id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: jsonBody({ isCompleted: item.isDone, expectedVersion: query.data.version }),
      })
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['task', id] }),
  })
  const recurrence = useMutation({
    mutationFn: (input: { frequency: string; interval: number; firstOccurrenceAt: string; until?: string }) => {
      if (!query.data) throw new Error('task_recurrence_context')
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
          expectedVersion: query.data.version,
        }),
      })
    },
    onSuccess: () => {
      setRecurrenceMessage('Повторення налаштовано.')
      clearDirty('recurrence')
      void client.invalidateQueries({ queryKey: ['task', id] })
    },
  })
  const addParticipant = useMutation({
    mutationFn: (input: {
      userId: string
      role: TaskParticipantRole
      expectedVersion: number
    }) => api(`/tasks/${id}/participants/${encodeURIComponent(input.userId)}`, {
      method: 'PUT',
      body: jsonBody({
        role: input.role === 'CO_EXECUTOR' ? 'COLLABORATOR' : 'WATCHER',
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: () => {
      setParticipantMessage('Учасника додано.')
      clearDirty('participant')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Склад завдання вже змінився. Оновіть його та повторіть дію.'
          : 'Не вдалося додати учасника. Перевірте, чи людина активна в організації.',
      )
    },
  })
  const removeParticipant = useMutation({
    mutationFn: (input: {
      userId: string
      role: TaskParticipantRole
      expectedVersion: number
    }) => api(`/tasks/${id}/participants/${encodeURIComponent(input.userId)}`, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: input.expectedVersion }),
    }),
    onSuccess: () => {
      setParticipantMessage('Учасника вилучено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Склад завдання вже змінився. Оновіть його та повторіть дію.'
          : 'Не вдалося вилучити учасника.',
      )
    },
  })
  return (
    <>
      <TaskDetailLayout
        title={query.data?.number ?? 'Завдання'}
        onRequestClose={() => closeGuard.requestClose('close-button')}
        footer={
          query.data?.canEdit && (
            <div className="drawer-actions">
              <select
                aria-label="Змінити статус"
                aria-describedby={statusError ? 'task-status-error' : undefined}
                disabled={status.isPending}
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
          {query.data.parent && (
            <Link
              className="task-parent-link"
              to={`/tasks/${query.data.parent.id}${location.search}`}
            >
              <ArrowLeft size={15} />
              До батьківського завдання · {query.data.parent.number}
            </Link>
          )}
          <div className="task-detail-heading">
            <div>
              <StatusBadge status={query.data.status} />
              <h3>{query.data.title}</h3>
              <p>{query.data.description || 'Опис не додано.'}</p>
            </div>
            {query.data.canEdit && (
              <Button
                type="button"
                variant={editOpen ? 'ghost' : 'secondary'}
                aria-expanded={editOpen}
                onClick={() => {
                  setEditMessage('')
                  if (editOpen) clearDirty('edit')
                  setEditOpen((value) => !value)
                }}
              >
                {editOpen ? <X size={16} /> : <Pencil size={16} />}
                {editOpen ? 'Закрити' : 'Редагувати'}
              </Button>
            )}
          </div>
          {editOpen && (
            <form
              className="task-edit-form"
              onChange={() => markDirty('edit')}
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                const deadline = String(form.get('deadline') ?? '')
                const creatorId = String(form.get('creatorId') ?? '')
                updateTask.mutate({
                  title: String(form.get('title') ?? ''),
                  description: String(form.get('description') ?? ''),
                  assigneeId: String(form.get('assigneeId') ?? query.data.assignee.id),
                  creatorId: creatorId || undefined,
                  deadline: deadline ? new Date(deadline).toISOString() : null,
                  priority: String(form.get('priority') ?? query.data.priority),
                  blockReason: String(form.get('blockReason') ?? '') || null,
                  expectedVersion: query.data.version,
                })
              }}
            >
              <div className="task-edit-form__intro">
                <strong>Редагування завдання</strong>
                <small>Зміни зберігаються з перевіркою актуальної версії.</small>
              </div>
              <label className="span-2">
                <span>
                  Назва <span aria-hidden="true">*</span>
                </span>
                <input
                  name="title"
                  defaultValue={query.data.title}
                  maxLength={180}
                  required
                  autoFocus
                />
              </label>
              <label className="span-2">
                Опис
                <textarea
                  name="description"
                  defaultValue={query.data.description}
                  rows={4}
                  maxLength={20000}
                  placeholder="Контекст і критерій готовності"
                />
              </label>
              {query.data.canReassign ? (
                <label>
                  <span>
                    Відповідальний <span aria-hidden="true">*</span>
                  </span>
                  <select
                    name="assigneeId"
                    defaultValue={query.data.assignee.id}
                    required
                  >
                    {employees.data?.items.map((employee) => (
                      <option value={employee.id} key={employee.id}>
                        {employee.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="task-edit-form__readonly">
                  <span>Відповідальний</span>
                  <strong>{query.data.assignee.displayName}</strong>
                  <input type="hidden" name="assigneeId" value={query.data.assignee.id} />
                </div>
              )}
              {query.data.canTransferCreator && (
                <label>
                  Постановник
                  <select name="creatorId" defaultValue={query.data.creator.id}>
                    {employees.data?.items.map((employee) => (
                      <option value={employee.id} key={employee.id}>
                        {employee.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Пріоритет
                <select name="priority" defaultValue={query.data.priority}>
                  <option value="LOW">Низький</option>
                  <option value="MEDIUM">Середній</option>
                  <option value="HIGH">Високий</option>
                  <option value="CRITICAL">Терміновий</option>
                </select>
              </label>
              <label>
                Строк
                <input
                  name="deadline"
                  type="datetime-local"
                  defaultValue={toLocalDateTimeInput(query.data.deadline)}
                />
              </label>
              {query.data.status === 'BLOCKED' && (
                <label className="span-2">
                  Причина блокування
                  <textarea
                    name="blockReason"
                    defaultValue={query.data.blockReason ?? ''}
                    rows={2}
                    maxLength={1000}
                    placeholder="Що саме заважає продовжити роботу?"
                  />
                </label>
              )}
              {editMessage && (
                <div className="form-error span-2" role="alert">{editMessage}</div>
              )}
              <div className="form-actions span-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    clearDirty('edit')
                    setEditOpen(false)
                  }}
                >
                  Скасувати
                </Button>
                <Button disabled={updateTask.isPending || employees.isLoading}>
                  Зберегти зміни
                </Button>
              </div>
            </form>
          )}
          {statusError && (
            <div
              className="task-blocker"
              id="task-status-error"
              role="alert"
              tabIndex={-1}
              ref={statusErrorRef}
            >
              <AlertTriangle size={18} />
              <span>
                <strong>Завдання ще не готове до завершення</strong>
                <small>{statusError}</small>
                {status.error instanceof ApiProblem
                  && status.error.problem.blockingSubtaskIds?.length
                  ? (
                      <span className="task-blocker__links">
                        {status.error.problem.blockingSubtaskIds.map((blockingId) => {
                          const subtask = query.data?.subtasks.find((item) => item.id === blockingId)
                          return (
                            <Link key={blockingId} to={`/tasks/${blockingId}${location.search}`}>
                              {subtask?.title ?? blockingId}
                            </Link>
                          )
                        })}
                      </span>
                    )
                  : null}
              </span>
            </div>
          )}
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
          <TaskDetailCustomization controller={detailPreference} />
          <TaskDetailSections controller={detailPreference}>
          <TaskDetailSection id="personal" label="Для мене">
          <section className="task-personal" aria-labelledby={`task-personal-${id}`}>
            <header>
              <div>
                <h4 id={`task-personal-${id}`}>Для мене</h4>
                <p>Особисті позначки не змінюють доступ інших людей.</p>
              </div>
              {query.data.personalState.followerCount > 0 && (
                <small>
                  {query.data.personalState.followerCount} стежать
                </small>
              )}
            </header>
            <div className="task-personal-actions">
              <button
                type="button"
                className={query.data.personalState.favorited ? 'is-active' : ''}
                aria-pressed={query.data.personalState.favorited}
                disabled={setUserState.isPending}
                onClick={() => setUserState.mutate({
                  favorited: !query.data.personalState.favorited,
                })}
              >
                <Star size={17} />
                {query.data.personalState.favorited ? 'В обраному' : 'До обраного'}
              </button>
              <button
                type="button"
                className={query.data.personalState.important ? 'is-active is-important' : ''}
                aria-pressed={query.data.personalState.important}
                disabled={setUserState.isPending}
                onClick={() => setUserState.mutate({
                  important: !query.data.personalState.important,
                })}
              >
                <Flag size={17} />
                {query.data.personalState.important ? 'Важливе' : 'Позначити важливим'}
              </button>
              <button
                type="button"
                className={query.data.personalState.following ? 'is-active' : ''}
                aria-pressed={query.data.personalState.following}
                disabled={follow.isPending || !user}
                onClick={() => follow.mutate(!query.data.personalState.following)}
              >
                <Eye size={17} />
                {query.data.personalState.following ? 'Стежу' : 'Стежити'}
              </button>
            </div>
            <details className="task-reminders">
              <summary>
                <Bell size={16} />
                Нагадування
                {query.data.personalState.reminders.length > 0
                  ? ` · ${query.data.personalState.reminders.length}`
                  : ''}
              </summary>
              <div>
                {query.data.personalState.reminders.length > 0 && (
                  <ul>
                    {query.data.personalState.reminders.map((reminder) => (
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
                    <input name="remindAt" type="datetime-local" required />
                  </label>
                  <Button variant="secondary" disabled={createReminder.isPending}>
                    <Bell size={16} />
                    Запланувати нагадування
                  </Button>
                </form>
              </div>
            </details>
            {personalMessage && (
              <p className="task-personal-message" aria-live="polite">{personalMessage}</p>
            )}
          </section>
          </TaskDetailSection>
          <TaskDetailSection id="participants" label="Учасники">
          <section className="task-participants" aria-labelledby={`task-participants-${id}`}>
            <header>
              <div>
                <h4 id={`task-participants-${id}`}>Учасники</h4>
                <p>Роль визначає робочий список і доступні дії для кожної людини.</p>
              </div>
              {query.data.canManageParticipants && (
                <Button
                  type="button"
                  variant={participantsOpen ? 'ghost' : 'secondary'}
                  aria-expanded={participantsOpen}
                  onClick={() => {
                    setParticipantMessage('')
                    if (participantsOpen) clearDirty('participant')
                    setParticipantsOpen((value) => !value)
                  }}
                >
                  {participantsOpen ? <X size={16} /> : <UserPlus size={16} />}
                  {participantsOpen ? 'Закрити' : 'Керувати'}
                </Button>
              )}
            </header>
            <div className="task-role-grid">
              <div className="task-role-group">
                <span>Відповідальний</span>
                <div className="task-person-chip">
                  <Avatar
                    size="sm"
                    name={query.data.assignee.displayName}
                    src={query.data.assignee.avatarAsset}
                  />
                  <strong>{query.data.assignee.displayName}</strong>
                </div>
              </div>
              <div className="task-role-group">
                <span>Постановник</span>
                <div className="task-person-chip">
                  <Avatar size="sm" name={query.data.creator.displayName} />
                  <strong>{query.data.creator.displayName}</strong>
                </div>
              </div>
              <TaskParticipantGroup
                label="Співвиконавці"
                emptyLabel="Ніхто не допомагає"
                participants={query.data.coExecutors}
                canRemove={query.data.canManageParticipants}
                pending={removeParticipant.isPending}
                onRemove={(userId) => removeParticipant.mutate({
                  userId,
                  role: 'CO_EXECUTOR',
                  expectedVersion: query.data.version,
                })}
              />
              <TaskParticipantGroup
                label="Спостерігачі"
                emptyLabel="Ніхто не спостерігає"
                participants={query.data.observers}
                canRemove={query.data.canManageParticipants}
                pending={removeParticipant.isPending}
                onRemove={(userId) => removeParticipant.mutate({
                  userId,
                  role: 'OBSERVER',
                  expectedVersion: query.data.version,
                })}
              />
            </div>
            {participantsOpen && (
              <form
                className="task-participant-form"
                onChange={() => markDirty('participant')}
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  setParticipantMessage('')
                  addParticipant.mutate({
                    userId: String(form.get('userId') ?? ''),
                    role: String(form.get('role')) as TaskParticipantRole,
                    expectedVersion: query.data.version,
                  })
                }}
              >
                <label>
                  Людина
                  <select name="userId" required defaultValue="">
                    <option value="" disabled>Оберіть людину</option>
                    {employees.data?.items
                      .filter((employee) => employee.id !== query.data.assignee.id)
                      .map((employee) => (
                        <option value={employee.id} key={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Роль у завданні
                  <select name="role" defaultValue="CO_EXECUTOR">
                    <option value="CO_EXECUTOR">Співвиконавець — може працювати</option>
                    <option value="OBSERVER">Спостерігач — читає та стежить</option>
                  </select>
                </label>
                <Button disabled={addParticipant.isPending || employees.isLoading}>
                  <UserPlus size={16} />
                  Додати учасника
                </Button>
              </form>
            )}
            {participantMessage && (
              <p className="task-participant-message" aria-live="polite">{participantMessage}</p>
            )}
          </section>
          </TaskDetailSection>
          {!query.data.parentTaskId && (
            <TaskDetailSection id="subtasks" label="Підзадачі">
            <section className="task-subtasks" aria-labelledby={`task-subtasks-${id}`}>
              <header>
                <div>
                  <h4 id={`task-subtasks-${id}`}>Підзадачі</h4>
                  <p>
                    {query.data.subtaskProgress.total
                      ? `${query.data.subtaskProgress.done} із ${query.data.subtaskProgress.total} завершено`
                      : 'Розбийте результат на окремі відповідальні кроки.'}
                  </p>
                </div>
                {query.data.canCreateSubtask && (
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
              {query.data.subtaskProgress.total > 0 && (
                <progress
                  aria-label="Прогрес підзадач"
                  value={query.data.subtaskProgress.done}
                  max={query.data.subtaskProgress.total}
                />
              )}
              {query.data.subtasks.length > 0 && (
                <div className="task-subtask-list">
                  {query.data.subtasks.map((subtask) => (
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
                    if (!query.data) return
                    const form = new FormData(event.currentTarget)
                    const deadline = String(form.get('deadline') ?? '')
                    createSubtask.mutate({
                      title: String(form.get('title') ?? ''),
                      description: String(form.get('description') ?? '') || undefined,
                      assigneeId: String(form.get('assigneeId') ?? ''),
                      deadline: deadline ? new Date(deadline).toISOString() : undefined,
                      priority: String(form.get('priority') ?? 'MEDIUM'),
                      expectedVersion: query.data.version,
                    })
                  }}
                >
                  <div className="task-subtask-form__intro">
                    <strong>Нова підзадача</strong>
                    <small>Робоча група та організаційний контекст успадковуються автоматично.</small>
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
                  <label>
                    <span>
                      Виконавець <span aria-hidden="true">*</span>
                    </span>
                    <select
                      name="assigneeId"
                      required
                      defaultValue={query.data.assignee.id}
                    >
                      {employees.data?.items.map((employee) => (
                        <option value={employee.id} key={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Пріоритет
                    <select name="priority" defaultValue={query.data.priority}>
                      <option value="LOW">Низький</option>
                      <option value="MEDIUM">Середній</option>
                      <option value="HIGH">Високий</option>
                      <option value="CRITICAL">Терміновий</option>
                    </select>
                  </label>
                  <label className="span-2">
                    Строк
                    <input name="deadline" type="datetime-local" />
                  </label>
                  <label className="span-2">
                    Опис
                    <textarea
                      name="description"
                      rows={3}
                      maxLength={20000}
                      placeholder="Контекст і критерій готовності"
                    />
                  </label>
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
                    <Button disabled={createSubtask.isPending || employees.isLoading}>
                      <CirclePlus size={16} />
                      Створити підзадачу
                    </Button>
                  </div>
                </form>
              )}
            </section>
            </TaskDetailSection>
          )}
          <TaskDetailSection id="checklist" label="Контрольний список">
          <section>
            <h4>Контрольний список</h4>
            {query.data.checklist?.length ? (
              <div className="checklist">
                {query.data.checklist.map((item) => (
                  <label className="checklist-row" key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.isDone}
                      disabled={!query.data.canEdit}
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
            {query.data.canEdit && (
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
          </TaskDetailSection>
          {query.data.canEdit && !query.data.parentTaskId && <TaskDetailSection id="recurrence" label="Повторення завдання"><section>
              <h4>Повторення завдання</h4>
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
          </section></TaskDetailSection>}
          <TaskDetailSection id="materials" label="Матеріали">
          <section className="task-materials">
              <header>
                <span>
                  <Paperclip size={17} />
                  Матеріали
                </span>
                <small>
                  {query.data.attachments.length + query.data.sourceLinks.length || 'Немає'}
                </small>
              </header>
              <div className="task-materials__body">
                {query.data.sourceLinks.length > 0 && (
                  <div className="task-source-links">
                    <span>Джерело</span>
                    {query.data.sourceLinks.map((source) => (
                      <Link key={source.id} to={source.href}>
                        <Link2 size={16} />
                        <span>
                          <strong>{source.label}</strong>
                          <small>{formatDateTime(source.createdAt)}</small>
                        </span>
                        <ChevronRight size={15} />
                      </Link>
                    ))}
                  </div>
                )}
                {query.data.attachments.length > 0 && (
                  <div className="task-attachment-list" aria-label="Файли завдання">
                    <span>Файли</span>
                    {query.data.attachments.map((attachment) => (
                      <div className="task-attachment-row" key={attachment.id}>
                        <TaskAttachment attachment={attachment} />
                        {attachment.canRemove && (
                          <button
                            type="button"
                            aria-label={`Вилучити ${attachment.fileName}`}
                            disabled={removeAttachment.isPending}
                            onClick={() => removeAttachment.mutate(attachment.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {query.data.canAttachFiles && (
                  <label className="task-file-picker">
                    <Paperclip size={16} />
                    <span>
                      <strong>{uploadAttachment.isPending ? 'Додаємо…' : 'Додати файл'}</strong>
                      <small>До 20 файлів у завданні</small>
                    </span>
                    <input
                      type="file"
                      disabled={uploadAttachment.isPending}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) uploadAttachment.mutate({ file, selectForComment: false })
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                )}
                {!query.data.sourceLinks.length && !query.data.attachments.length && (
                  <p className="muted">Додайте файл або створіть завдання з повідомлення чи процесу.</p>
                )}
                {contentMessage && (
                  <p className="task-content-message" aria-live="polite">{contentMessage}</p>
                )}
              </div>
          </section>
          </TaskDetailSection>
          <TaskDetailSection id="history" label="Історія змін">
          <section className="task-history">
              <header>
                <History size={17} />
                <h4>Історія змін</h4>
              </header>
              <div className="task-history__body">
                {activity.isLoading ? (
                  <Skeleton rows={3} />
                ) : activity.isError ? (
                  <div className="form-error" role="alert">
                    Не вдалося завантажити історію.
                  </div>
                ) : activity.data?.pages.some((pageResult) => pageResult.items.length) ? (
                  <>
                    <ol className="activity-timeline">
                      {activity.data.pages.flatMap((pageResult) => pageResult.items).map((item) => (
                        <li key={item.id}>
                          <i />
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.actor?.displayName ?? 'Система'}</p>
                            <small>{formatDateTime(item.createdAt)}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {activity.hasNextPage && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={activity.isFetchingNextPage}
                        onClick={() => void activity.fetchNextPage()}
                      >
                        Показати давніші зміни
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="muted">Історія ще порожня.</p>
                )}
              </div>
          </section>
          </TaskDetailSection>
          <TaskDetailSection id="discussion" label="Обговорення">
          <section className="task-discussion" aria-labelledby={`task-discussion-${id}`}>
            <header>
              <div>
                <h4 id={`task-discussion-${id}`}>Обговорення</h4>
                <p>Рішення та уточнення залишаються поруч із завданням.</p>
              </div>
              {query.data.comments.length > 0 && (
                <small>{query.data.comments.length}</small>
              )}
            </header>
            {query.data.comments.length > 0 ? (
              <div className="task-comments">
                {query.data.comments.map((item) => (
                  <article className={item.replyToCommentId ? 'is-reply' : ''} key={item.id}>
                    <Avatar
                      size="sm"
                      name={item.author.displayName}
                      src={item.author.avatarAsset}
                    />
                    <div>
                      <header>
                        <strong>{item.author.displayName}</strong>
                        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                      </header>
                      {item.replyPreview && (
                        <blockquote>
                          <strong>{item.replyPreview.authorName}</strong>
                          <span>{item.replyPreview.body}</span>
                        </blockquote>
                      )}
                      <p><MentionText body={item.body} mentions={item.mentions} /></p>
                      {item.attachments.length > 0 && (
                        <div className="task-comment-attachments">
                          {item.attachments.map((attachment) => (
                            <TaskAttachment key={attachment.id} attachment={attachment} compact />
                          ))}
                        </div>
                      )}
                      {!item.replyToCommentId && (
                        <button
                          type="button"
                          className="task-comment-reply"
                          onClick={() => {
                            setReplyTo({
                              id: item.id,
                              authorName: item.author.displayName,
                              body: item.body,
                            })
                          }}
                        >
                          <Reply size={14} />
                          Відповісти
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">Ще немає коментарів. Додайте перше корисне уточнення.</p>
            )}
            <form
              className="task-comment-form"
              onSubmit={(event) => {
                event.preventDefault()
                const trimmed = trimMentionValue(comment, commentMentions)
                if (trimmed.body) {
                  const signature = JSON.stringify({
                    taskId: id,
                    body: trimmed.body,
                    mentions: trimmed.mentions,
                    replyToCommentId: replyTo?.id ?? null,
                    attachmentIds: commentAttachmentIds,
                  })
                  if (commentAttemptRef.current.signature !== signature) {
                    commentAttemptRef.current = {
                      signature,
                      key: idempotencyKey('task-comment'),
                    }
                  }
                  post.mutate({
                    body: trimmed.body,
                    mentions: trimmed.mentions,
                    replyToCommentId: replyTo?.id ?? null,
                    attachmentIds: commentAttachmentIds,
                    key: commentAttemptRef.current.key,
                  })
                }
              }}
            >
              {replyTo && (
                <div className="task-reply-context">
                  <Reply size={15} />
                  <span>
                    <strong>Відповідь для {replyTo.authorName}</strong>
                    <small>{replyTo.body.slice(0, 120)}</small>
                  </span>
                  <button
                    type="button"
                    aria-label="Скасувати відповідь"
                    onClick={() => setReplyTo(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <MentionTextarea
                label="Коментар до завдання"
                value={comment}
                mentions={commentMentions}
                candidateUrl={`/tasks/${id}/mention-candidates`}
                onChange={(value, mentions) => {
                  setComment(value)
                  setCommentMentions(mentions)
                }}
                rows={2}
                maxLength={4000}
                visuallyHiddenLabel
                placeholder={replyTo ? 'Напишіть коротку відповідь…' : 'Додати корисний коментар…'}
              />
              {commentAttachmentIds.length > 0 && (
                <div className="task-comment-selected-files" aria-label="Файли коментаря">
                  {commentAttachmentIds.map((fileId) => {
                    const attachment = query.data.attachments.find((item) => item.id === fileId)
                    return (
                      <span key={fileId}>
                        <FileText size={14} />
                        <strong>{attachment?.fileName ?? 'Новий файл'}</strong>
                        <button
                          type="button"
                          aria-label={`Прибрати ${attachment?.fileName ?? 'файл'} з коментаря`}
                          onClick={() => setCommentAttachmentIds((current) => (
                            current.filter((idValue) => idValue !== fileId)
                          ))}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              <div className="task-comment-controls">
                <div>
                  <label className="task-comment-file-picker">
                    <Paperclip size={15} />
                    {uploadAttachment.isPending ? 'Додаємо…' : 'Новий файл'}
                    <input
                      type="file"
                      disabled={uploadAttachment.isPending || commentAttachmentIds.length >= 5}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) uploadAttachment.mutate({ file, selectForComment: true })
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                  {query.data.attachments.some((attachment) => (
                    !commentAttachmentIds.includes(attachment.id)
                  )) && (
                    <select
                      aria-label="Додати файл із матеріалів"
                      value=""
                      disabled={commentAttachmentIds.length >= 5}
                      onChange={(event) => {
                        const fileId = event.target.value
                        if (fileId) {
                          setCommentAttachmentIds((current) => [...current, fileId].slice(0, 5))
                        }
                      }}
                    >
                      <option value="">Із матеріалів…</option>
                      {query.data.attachments
                        .filter((attachment) => !commentAttachmentIds.includes(attachment.id))
                        .map((attachment) => (
                          <option value={attachment.id} key={attachment.id}>
                            {attachment.fileName}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <Button disabled={!comment.trim() || post.isPending || uploadAttachment.isPending}>
                Надіслати <ChevronRight size={16} />
                </Button>
              </div>
              {contentMessage && (
                <p className="task-content-message" aria-live="polite">{contentMessage}</p>
              )}
            </form>
          </section>
          </TaskDetailSection>
          </TaskDetailSections>
        </div>
        )}
      </TaskDetailLayout>
      <UnsavedChangesDialog guard={closeGuard} />
    </>
  )
}

function TaskDetailLayout({
  title,
  onRequestClose,
  footer,
  children,
}: {
  title: string
  onRequestClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="task-detail-page">
      <PageHeader
        title={title}
        action={
          <div className="task-detail-page__actions">
            {footer}
            <Button type="button" variant="secondary" onClick={onRequestClose}>
              <ArrowLeft size={16} />
              До списку
            </Button>
          </div>
        }
      />
      <Card className="task-detail-surface">{children}</Card>
    </div>
  )
}

function TaskAttachment({
  attachment,
  compact = false,
}: {
  attachment: TaskAttachmentView
  compact?: boolean
}) {
  const status = useQuery({
    queryKey: ['file-status', attachment.id],
    queryFn: () => api<{ scanStatus: TaskAttachmentView['scanStatus'] }>(
      `/files/${attachment.id}/status`,
    ),
    enabled: !['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(attachment.scanStatus),
    refetchInterval: (result) => {
      const current = result.state.data?.scanStatus ?? attachment.scanStatus
      return ['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(current)
        ? false
        : 2_000
    },
  })
  const scanStatus = status.data?.scanStatus ?? attachment.scanStatus
  const content = (
    <>
      <FileText size={compact ? 15 : 17} />
      <span>
        <strong>{attachment.fileName}</strong>
        <small>
          {scanStatus === 'CLEAN'
            ? formatBytes(attachment.bytes)
            : taskAttachmentStateLabel(scanStatus)}
        </small>
      </span>
      {scanStatus === 'CLEAN' && <Download size={15} />}
    </>
  )
  if (scanStatus === 'CLEAN') {
    return (
      <a
        className={compact ? 'task-attachment is-compact' : 'task-attachment'}
        href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}
      >
        {content}
      </a>
    )
  }
  return (
    <span className={compact ? 'task-attachment is-compact' : 'task-attachment'}>
      {content}
    </span>
  )
}

function TaskParticipantGroup({
  label,
  emptyLabel,
  participants,
  canRemove,
  pending,
  onRemove,
}: {
  label: string
  emptyLabel: string
  participants: TaskDetailView['coExecutors']
  canRemove: boolean
  pending: boolean
  onRemove: (userId: string) => void
}) {
  return (
    <div className="task-role-group">
      <span>{label}</span>
      {participants.length ? (
        <div className="task-role-people">
          {participants.map((participant) => (
            <div className="task-person-chip" key={participant.id}>
              <Avatar
                size="sm"
                name={participant.user.displayName}
                src={participant.user.avatarAsset}
              />
              <strong>{participant.user.displayName}</strong>
              {canRemove && (
                <button
                  type="button"
                  className="task-participant-remove"
                  aria-label={`Вилучити ${participant.user.displayName} з ролі «${label}»`}
                  disabled={pending}
                  onClick={() => onRemove(participant.user.id)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <small>{emptyLabel}</small>
      )}
    </div>
  )
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function taskAttachmentStateLabel(status: TaskAttachmentView['scanStatus']): string {
  if (status === 'QUARANTINED' || status === 'SCANNING') return 'Перевіряється'
  if (status === 'INFECTED') return 'Заблоковано перевіркою'
  if (status === 'UNSUPPORTED') return 'Формат не підтримується'
  return 'Файл недоступний'
}

function TaskFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Усі</option>
        {value && !options.some((option) => option.id === value) && <option value={value}>Збережене значення</option>}
        {options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
      </select>
    </label>
  )
}

function taskPriorityLabel(priority: TaskListItem['priority']): string {
  return {
    LOW: 'Низький',
    MEDIUM: 'Середній',
    HIGH: 'Високий',
    CRITICAL: 'Терміновий',
  }[priority]
}

function isTaskOverdue(task: TaskListItem): boolean {
  return Boolean(
    task.deadline
    && new Date(task.deadline).getTime() < Date.now()
    && !['DONE', 'CANCELLED', 'ARCHIVED'].includes(task.status),
  )
}

function taskRoleEmptyState(role: TaskViewRole): { title: string; description: string } {
  if (role === 'CO_EXECUTOR') {
    return {
      title: 'Поки не допомагаєте в інших завданнях',
      description: 'Тут з’являться завдання, де вас додадуть співвиконавцем.',
    }
  }
  if (role === 'CREATOR') {
    return {
      title: 'Ви ще нічого не доручили',
      description: 'Створені вами завдання залишатимуться тут незалежно від виконавця.',
    }
  }
  if (role === 'OBSERVER') {
    return {
      title: 'Немає завдань для спостереження',
      description: 'Тут з’являться завдання, за перебігом яких вас попросили стежити.',
    }
  }
  if (role === 'ALL') {
    return {
      title: 'Доступних завдань не знайдено',
      description: 'Скиньте додаткові фільтри або змініть пошуковий запит.',
    }
  }
  return {
    title: 'Немає завдань, за які ви відповідаєте',
    description: 'Нове призначення автоматично з’явиться у цьому списку.',
  }
}
