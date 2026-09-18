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
} from '@lankadws/contracts'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bell,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Copy,
  Eye,
  FileText,
  HardDrive,
  Heart,
  Link2,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Play,
  Reply,
  Search,
  Send,
  Trash2,
  RotateCcw,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiProblem, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { TaskCreateModal } from '../features/tasks/create/TaskCreateModal'
import { AsyncTaskCombobox } from '../features/tasks/AsyncTaskCombobox'
import { DrivePicker } from '../features/drive/DrivePicker'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { TaskListColumnsControl, useTaskListColumnsPreference } from '../features/tasks/list/TaskListColumns'
import { MentionText } from '../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../shared/mentions/mentionText'
import { MessageComposerFrame } from '../shared/messages/MessageComposerFrame'
import { formatChatTime } from '../features/messages/lib/chatDates'
import { usePreservedChatScroll } from '../features/messages/hooks/usePreservedChatScroll'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageDataLoader,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'
import '../features/tasks/detail/task-detail.css'

function contextMenuPosition(x: number, y: number): { left: number; top: number } {
  const menuWidth = 248
  const menuHeight = 260
  const inset = 8
  return {
    left: Math.max(inset, Math.min(x, window.innerWidth - menuWidth - inset)),
    top: Math.max(inset, Math.min(y, window.innerHeight - menuHeight - inset)),
  }
}

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
  const isCreating = location.pathname === '/tasks/new'
  const copyFrom = params.get('copyFrom') ?? ''
  const copySource = useQuery({
    queryKey: ['task-copy-source', copyFrom],
    queryFn: () => api<TaskDetailView>(`/tasks/${encodeURIComponent(copyFrom)}`),
    enabled: isCreating && Boolean(copyFrom),
  })
  const taskListColumns = useTaskListColumnsPreference()
  return (
    <div>
      <PageHeader
        title="Завдання"
        description="Окремі робочі списки за вашою роллю в кожному завданні"
        action={(
          <Link className="button button--primary" to="/tasks/new">
            <Plus size={17} />
            Створити завдання
          </Link>
        )}
      />
      <Card className="list-card task-list-card">
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
        {filtersOpen && (
          <div className="filter-panel">
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
                <option value="IN_PROGRESS">В роботі</option>
                <option value="IN_REVIEW">На перевірці</option>
                <option value="DONE">Виконано</option>
                <option value="ARCHIVED">Архівовані</option>
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
          <PageDataLoader />
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
                    </td>
                    {taskListColumns.visible.includes('responsibles') && <td data-label="Виконавці">
                      {task.responsibles.length ? (
                        <span className="person-cell task-responsibles">
                          {task.responsibles.map((responsible) => (
                            <UserProfileLink
                              className="task-list-person"
                              key={responsible.id}
                              userId={responsible.id}
                            >
                              <Avatar size="sm" name={responsible.displayName} src={responsible.avatarAsset} />
                              {responsible.displayName}
                            </UserProfileLink>
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
                    {taskListColumns.visible.includes('reporter') && <td data-label="Постановник"><UserProfileLink className="person-cell" userId={task.reporter.id}><Avatar size="sm" name={task.reporter.displayName} src={task.reporter.avatarAsset} />{task.reporter.displayName}</UserProfileLink></td>}
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
      {isCreating && (!copyFrom || copySource.isSuccess) && (
        <TaskCreateModal
          groupId={params.get('groupId') ?? ''}
          initialResponsibleId={params.get('assigneeId') ?? ''}
          copySource={copySource.data}
          copyFrom={copyFrom}
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
  const navigate = useNavigate()
  const { user } = useAuth()
  const [comment, setComment] = useState('')
  const [commentMentions, setCommentMentions] = useState<StructuredMentionInput[]>([])
  const [editingComment, setEditingComment] = useState<{
    id: string
    body: string
    mentions: StructuredMentionInput[]
  } | null>(null)
  const [openCommentMenu, setOpenCommentMenu] = useState<{
    id: string
    left: number
    top: number
  } | null>(null)
  const commentMenuCloseTimerRef = useRef<number | null>(null)
  const commentAttemptRef = useRef({ signature: '', key: '' })
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [replyTo, setReplyTo] = useState<{
    id: string
    authorName: string
    body: string
  } | null>(null)
  const [commentAttachmentIds, setCommentAttachmentIds] = useState<string[]>([])
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const closeCommentMenu = () => {
    if (commentMenuCloseTimerRef.current !== null) window.clearTimeout(commentMenuCloseTimerRef.current)
    setOpenCommentMenu(null)
  }
  const delayCommentMenuClose = () => {
    commentMenuCloseTimerRef.current = window.setTimeout(closeCommentMenu, 120)
  }
  const keepCommentMenuOpen = () => {
    if (commentMenuCloseTimerRef.current !== null) window.clearTimeout(commentMenuCloseTimerRef.current)
  }
  useEffect(() => {
    const closeOnOtherMenu = () => closeCommentMenu()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.task-comment-action-menu')) closeCommentMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCommentMenu() }
    window.addEventListener('lanka:context-menu-open', closeOnOtherMenu)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('lanka:context-menu-open', closeOnOtherMenu)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  const [contentMessage, setContentMessage] = useState('')
  const [newItem, setNewItem] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false)
  const [subtaskError, setSubtaskError] = useState('')
  const [participantMessage, setParticipantMessage] = useState('')
  const [statusError, setStatusError] = useState('')
  const [recurrenceMessage, setRecurrenceMessage] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
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
      || editingComment
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
  const employees = useQuery({
    queryKey: ['employees', 'task-form'],
    queryFn: () => api<{ items: Employee[] }>('/employees'),
    enabled: editOpen || subtaskFormOpen,
  })
  const activity = useInfiniteQuery({
    queryKey: ['task-activity', id],
    queryFn: ({ pageParam }) =>
      api<TaskActivityPage>(
        `/tasks/${id}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: query.isSuccess,
  })
  const updateTask = useMutation({
    mutationFn: (input: {
      title: string
      description: string
      assigneeId: string
      creatorId?: string
      deadline: string | null
      priority: string
      blockReason: string | null
      requiresAcceptance: boolean
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
  const reassignResponsible = useMutation({
    mutationFn: (assigneeId: string) => {
      if (!query.data) throw new Error('task_reassign_context')
      return api<{ version: number }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: jsonBody({
          title: query.data.title,
          description: query.data.description,
          assigneeId,
          deadline: query.data.deadline,
          priority: query.data.priority,
          blockReason: query.data.blockReason,
          expectedVersion: query.data.version,
        }),
      })
    },
    onSuccess: () => {
      setParticipantMessage('Відповідального змінено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Завдання вже змінилося. Оновіть його та повторіть зміну відповідального.'
          : 'Не вдалося змінити відповідального.',
      )
    },
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
  const status = useMutation({
    mutationFn: (input: { action: 'START' | 'COMPLETE' | 'APPROVE' | 'RETURN_TO_WORK'; expectedVersion: number; note?: string }) =>
      api(`/tasks/${id}/transitions`, { method: 'POST', body: jsonBody(input) }),
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
      keepDraft?: boolean
    }) => {
      const { key, keepDraft: _keepDraft, ...body } = input
      return api(`/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: jsonBody(body),
      })
    },
    onSuccess: (_result, input) => {
      if (!input.keepDraft) {
        setComment('')
        setCommentMentions([])
        commentAttemptRef.current = { signature: '', key: '' }
        setReplyTo(null)
        setCommentAttachmentIds([])
        window.requestAnimationFrame(() => commentTextareaRef.current?.focus())
      }
      setContentMessage('')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: () => setContentMessage('Не вдалося надіслати коментар. Перевірте текст і вкладення.'),
  })
  const archiveTask = useMutation({
    mutationFn: () => api(`/tasks/${id}/archive`, {
      method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
  })
  const updateComment = useMutation({
    mutationFn: (input: {
      commentId: string
      body: string
      mentions: StructuredMentionInput[]
      expectedVersion: number
    }) => api(`/tasks/${id}/comments/${encodeURIComponent(input.commentId)}`, {
      method: 'PATCH',
      body: jsonBody({
        body: input.body,
        mentions: input.mentions,
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: () => {
      setEditingComment(null)
      setContentMessage('Повідомлення відредаговано.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: (error) => setContentMessage(
      error instanceof ApiProblem && error.problem.status === 409
        ? 'Повідомлення вже змінилося. Оновіть завдання та повторіть дію.'
        : 'Не вдалося відредагувати повідомлення.',
    ),
  })
  const deleteComment = useMutation({
    mutationFn: (input: { commentId: string; expectedVersion: number }) =>
      api(`/tasks/${id}/comments/${encodeURIComponent(input.commentId)}`, {
        method: 'DELETE',
        body: jsonBody({ expectedVersion: input.expectedVersion }),
      }),
    onSuccess: (_result, input) => {
      setEditingComment((current) => current?.id === input.commentId ? null : current)
      setContentMessage('Повідомлення видалено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
    },
    onError: (error) => setContentMessage(
      error instanceof ApiProblem && error.problem.status === 409
        ? 'Повідомлення вже змінилося. Оновіть завдання та повторіть дію.'
        : 'Не вдалося видалити повідомлення.',
    ),
  })
  const reactToComment = useMutation({
    mutationFn: (item: TaskDetailView['comments'][number]) => api(
      `/tasks/${id}/comments/${encodeURIComponent(item.id)}/reactions`,
      {
        method: item.reactions.likedByMe ? 'DELETE' : 'POST',
        body: jsonBody({ kind: 'LIKE' }),
      },
    ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['task', id] }),
    onError: () => setContentMessage('Не вдалося змінити вподобання повідомлення.'),
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
  const attachDriveFile = useMutation({
    mutationFn: (fileId: string) => api<TaskAttachmentView>(`/tasks/${id}/attachments/from-drive`, {
      method: 'POST',
      body: jsonBody({ fileId }),
    }),
    onSuccess: (attachment) => {
      setCommentAttachmentIds((current) => (
        current.includes(attachment.id) ? current : [...current, attachment.id].slice(0, 5)
      ))
      setContentMessage('Файл із Диска додано до повідомлення.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => setContentMessage('Не вдалося додати файл із Диска.'),
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
  const canAttachFiles = Boolean(query.data?.canAttachFiles)
    && !uploadAttachment.isPending
    && !attachDriveFile.isPending
  async function uploadFiles(files: File[], selectForComment: boolean) {
    for (const file of files) {
      await uploadAttachment.mutateAsync({ file, selectForComment }).catch(() => undefined)
    }
  }
  const materialsDrop = useFileDropTarget({
    disabled: !canAttachFiles,
    onFiles: (files) => void uploadFiles(files, false),
  })
  const commentFilesDrop = useFileDropTarget({
    disabled: !canAttachFiles || commentAttachmentIds.length >= 5,
    onFiles: (files) => void uploadFiles(files.slice(0, 5 - commentAttachmentIds.length), true),
  })
  const discussionEntries = [
    ...(query.data?.comments.map((item) => ({
      kind: 'comment' as const,
      id: item.id,
      createdAt: item.createdAt,
      item,
    })) ?? []),
    ...(activity.data?.pages
      .flatMap((pageResult) => pageResult.items)
      .filter((item) => item.action !== 'task.comment_created')
      .map((item) => ({
        kind: 'activity' as const,
        id: item.id,
        createdAt: item.createdAt,
        item,
      })) ?? []),
  ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  const discussionScroll = usePreservedChatScroll(discussionEntries.length, id)
  const discussionScrollTopRef = useRef<number | null>(null)
  const discussionScrollingUpRef = useRef(false)
  const discussionHasScrollIntentRef = useRef(false)
  const discussionPointerYRef = useRef<number | null>(null)
  const discussionLoadingOlderRef = useRef(false)

  useEffect(() => {
    if (!activity.isFetchingNextPage) discussionLoadingOlderRef.current = false
  }, [activity.isFetchingNextPage])

  function loadOlderDiscussionEntries(element: HTMLDivElement) {
    const previousScrollTop = discussionScrollTopRef.current
    const scrolledUp = discussionScrollingUpRef.current
      || (previousScrollTop !== null && element.scrollTop < previousScrollTop)
    discussionScrollTopRef.current = element.scrollTop
    discussionScrollingUpRef.current = false
    if (
      !scrolledUp
      || !discussionHasScrollIntentRef.current
      || element.scrollTop > 72
      || !activity.hasNextPage
      || activity.isFetchingNextPage
      || discussionLoadingOlderRef.current
    ) return
    discussionHasScrollIntentRef.current = false
    discussionLoadingOlderRef.current = true
    discussionScroll.rememberBeforePrepend()
    void activity.fetchNextPage().catch(() => {
      discussionLoadingOlderRef.current = false
    })
  }
  const canManageTask = Boolean(
    query.data
    && user
    && query.data.canEdit
    && (user.accountType === 'ADMIN' || user.id === query.data.reporter.id),
  )
  return (
    <>
      <TaskDetailLayout
        title={query.data?.number ?? 'Завдання'}
      >
      {query.isLoading ? (
        <PageDataLoader />
      ) : query.isError || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <div className="detail-stack">
          <div className="task-detail-main">
          <section className="task-detail-overview">
          <div className="task-detail-heading">
            <div>
              <span className="task-detail-number">Завдання №{query.data.number}</span>
              <h2>{query.data.title}</h2>
              <p>{query.data.description || 'Опис не додано.'}</p>
            </div>
            <div className="task-detail-heading-actions">
              {query.data.availableStatusActions.length > 0 && (
                <div className="task-detail-status-actions">
                  {query.data.availableStatusActions.includes('START') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'START', expectedVersion: query.data.version })}><Play size={16} />Почати роботу</Button>}
                  {query.data.availableStatusActions.includes('COMPLETE') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'COMPLETE', expectedVersion: query.data.version })}><CheckCircle2 size={16} />Завершити</Button>}
                  {query.data.availableStatusActions.includes('APPROVE') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'APPROVE', expectedVersion: query.data.version })}><CheckCircle2 size={16} />Прийняти</Button>}
                  {query.data.availableStatusActions.includes('RETURN_TO_WORK') && <Button type="button" variant="secondary" disabled={status.isPending} onClick={() => {
                    const note = window.prompt('Коментар для відповідального (необов’язково):')
                    if (note !== null) status.mutate({ action: 'RETURN_TO_WORK', expectedVersion: query.data.version, note })
                  }}><RotateCcw size={16} />Повернути в роботу</Button>}
                </div>
              )}
              <details
                className="task-detail-actions-menu"
                open={actionsOpen}
                onToggle={(event) => setActionsOpen(event.currentTarget.open)}
              >
                <summary aria-label="Дії із завданням">
                  <MoreHorizontal size={20} />
                </summary>
                <div role="menu">
                <button type="button" role="menuitem" onClick={() => navigate(`/tasks/new?copyFrom=${encodeURIComponent(id)}`)}><Copy size={16} />Копіювати задачу</button>
                {canManageTask && query.data.status !== 'IN_REVIEW' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false)
                      setEditMessage('')
                      if (editOpen) clearDirty('edit')
                      setEditOpen((value) => !value)
                    }}
                  >
                    {editOpen ? <X size={16} /> : <Pencil size={16} />}
                    {editOpen ? 'Закрити редагування' : 'Редагувати'}
                  </button>
                )}
                {canManageTask && query.data.canCreateSubtask && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false)
                      setLinksOpen(true)
                      setSubtaskFormOpen(true)
                    }}
                  >
                    <CirclePlus size={16} />
                    Створити підзавдання
                  </button>
                )}
                {canManageTask && query.data.status !== 'ARCHIVED' && (
                  <button type="button" role="menuitem" disabled={archiveTask.isPending} onClick={() => {
                    setActionsOpen(false)
                    if (window.confirm('Архівувати це завдання?')) archiveTask.mutate()
                  }}><Archive size={16} />Архівувати</button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false)
                    closeGuard.requestClose('close-button')
                  }}
                >
                  <ArrowLeft size={16} />
                  До списку
                </button>
                </div>
              </details>
            </div>
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
                  requiresAcceptance: form.get('requiresAcceptance') === 'on',
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
              <input type="hidden" name="assigneeId" value={query.data.assignee.id} />
              {query.data.canTransferCreator && (
                <label>
                  Постановник
                  <select name="creatorId" defaultValue={query.data.creator.id}>
                    <option value={query.data.creator.id}>
                      {query.data.creator.displayName}
                    </option>
                    {employees.data?.items
                      .filter((employee) => employee.id !== query.data.creator.id)
                      .map((employee) => (
                        <option value={employee.id} key={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="task-edit-form__workflow span-2">
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
                <label
                  className="task-create-acceptance"
                  title="Після завершення відповідальним задача перейде постановнику на перевірку."
                >
                  <span><strong>Прийняти після завершення</strong></span>
                  <input name="requiresAcceptance" type="checkbox" defaultChecked={query.data.requiresAcceptance} />
                </label>
              </div>
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
          </section>
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
          <details
            className="task-detail-materials is-file-drop-target"
            data-task-section="materials"
            {...materialsDrop.dropTargetProps}
          >
              <FileDropOverlay active={materialsDrop.isDragging} label="Відпустіть файли, щоб додати до завдання" />
              <summary aria-label="Матеріали">
                <span className="task-detail-card-icon"><Paperclip size={18} /></span>
                <span>
                  <strong>Матеріали</strong>
                  <small>Файли й пов’язані джерела</small>
                </span>
                <small className="task-detail-count">
                  {query.data.attachments.length + query.data.sourceLinks.length || 'Немає'}
                </small>
                <ChevronDown size={18} />
              </summary>
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
                      <small>Перетягніть файли сюди · до 20 файлів у завданні</small>
                    </span>
                    <input
                      type="file"
                      multiple
                      aria-label="Додати файл"
                      disabled={uploadAttachment.isPending}
                      onChange={(event) => {
                        void uploadFiles([...event.target.files ?? []], false)
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
          </details>
          <section
            className="task-discussion is-file-drop-target"
            data-task-section="discussion"
            aria-labelledby={`task-discussion-${id}`}
            {...commentFilesDrop.dropTargetProps}
          >
            <FileDropOverlay active={commentFilesDrop.isDragging} label="Відпустіть файли, щоб додати до коментаря" />
            <header>
              <span className="task-discussion__title">
                <span className="task-detail-card-icon"><MessageCircle size={18} /></span>
                <h3 id={`task-discussion-${id}`}>Обговорення</h3>
              </span>
            </header>
            <div
              ref={discussionScroll.containerRef}
              className="task-discussion__body"
              tabIndex={0}
              aria-label="Повідомлення та історія обговорення"
              onKeyDown={(event) => {
                discussionScroll.onUserScrollIntent()
                if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
                  discussionHasScrollIntentRef.current = true
                  discussionScrollingUpRef.current = true
                }
              }}
              onPointerDown={(event) => {
                discussionScroll.onUserScrollIntent()
                discussionPointerYRef.current = event.clientY
                discussionScrollTopRef.current = event.currentTarget.scrollTop
              }}
              onPointerMove={(event) => {
                if (discussionPointerYRef.current === null) return
                discussionHasScrollIntentRef.current = true
                discussionScrollingUpRef.current = event.clientY > discussionPointerYRef.current
                discussionPointerYRef.current = event.clientY
              }}
              onPointerUp={() => { discussionPointerYRef.current = null }}
              onTouchStart={() => {
                discussionScroll.onUserScrollIntent()
                discussionHasScrollIntentRef.current = true
              }}
              onWheel={(event) => {
                discussionScroll.onUserScrollIntent()
                discussionHasScrollIntentRef.current = true
                discussionScrollingUpRef.current = event.deltaY < 0
              }}
              onScroll={(event) => {
                discussionScroll.onScroll()
                loadOlderDiscussionEntries(event.currentTarget)
              }}
            >
            {discussionEntries.length > 0 ? (
              <div ref={discussionScroll.contentRef} className="task-comments">
                {discussionEntries.map((entry) => {
                  if (entry.kind === 'activity') {
                    return (
                      <div className="task-system-event" key={entry.id}>
                        <span>
                          {entry.item.actor?.displayName
                            ? `${entry.item.actor.displayName} · ${entry.item.label}`
                            : entry.item.label}
                        </span>
                        <time dateTime={entry.item.createdAt}>{formatDateTime(entry.item.createdAt)}</time>
                      </div>
                    )
                  }
                  const item = entry.item
                  const ownComment = item.author.id === user?.id
                  return (
                    <article
                      className={`task-comment ${ownComment ? 'is-own' : 'is-other'}${item.replyToCommentId ? ' is-reply' : ''}`}
                      key={item.id}
                      onContextMenu={(event) => {
                        if ((event.target as HTMLElement).closest('button, a, input, textarea')) return
                        event.preventDefault()
                        window.dispatchEvent(new CustomEvent('lanka:context-menu-open'))
                        setOpenCommentMenu({ id: item.id, ...contextMenuPosition(event.clientX, event.clientY) })
                      }}
                    >
                      {!ownComment && (
                        <UserProfileLink
                          className="task-comment__author-avatar"
                          userId={item.author.id}
                          aria-label={`Відкрити профіль ${item.author.displayName}`}
                        >
                          <Avatar
                            size="sm"
                            name={item.author.displayName}
                            src={item.author.avatarAsset}
                          />
                        </UserProfileLink>
                      )}
                      <div className="task-comment__bubble">
                        {!ownComment && (
                          <UserProfileLink className="task-comment__author" userId={item.author.id}>
                            {item.author.displayName}
                          </UserProfileLink>
                        )}
                        {item.replyPreview && (
                          <blockquote>
                            <strong>{item.replyPreview.authorName}</strong>
                            <span>{item.replyPreview.body}</span>
                          </blockquote>
                        )}
                        {editingComment?.id === item.id ? (
                          <form
                            className="task-comment-edit-form"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const trimmed = trimMentionValue(
                                editingComment.body,
                                editingComment.mentions,
                              )
                              if (!trimmed.body) return
                              updateComment.mutate({
                                commentId: item.id,
                                body: trimmed.body,
                                mentions: trimmed.mentions,
                                expectedVersion: item.version,
                              })
                            }}
                          >
                            <MentionTextarea
                              label="Редагувати повідомлення"
                              value={editingComment.body}
                              mentions={editingComment.mentions}
                              candidateUrl={`/tasks/${id}/mention-candidates`}
                              onChange={(body, mentions) => setEditingComment({
                                id: item.id,
                                body,
                                mentions,
                              })}
                              rows={3}
                              maxLength={4000}
                              autoFocus
                              visuallyHiddenLabel
                            />
                            <div>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setEditingComment(null)}
                              >
                                Скасувати
                              </Button>
                              <Button disabled={!editingComment.body.trim() || updateComment.isPending}>
                                Зберегти
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <p><MentionText body={item.body} mentions={item.mentions} /></p>
                        )}
                        {editingComment?.id !== item.id && item.attachments.length > 0 && (
                          <div className="task-comment-attachments">
                            {item.attachments.map((attachment) => (
                              <TaskAttachment key={attachment.id} attachment={attachment} compact />
                            ))}
                          </div>
                        )}
                        {editingComment?.id !== item.id && (
                          <footer className="task-comment__meta">
                            {item.reactions.likeCount > 0 && (
                              <button
                                type="button"
                                className={item.reactions.likedByMe ? 'is-mine' : ''}
                                aria-label={`${item.reactions.likeCount} вподобань`}
                                aria-pressed={item.reactions.likedByMe}
                                onClick={() => reactToComment.mutate(item)}
                              >
                                <Heart size={12} /> {item.reactions.likeCount}
                              </button>
                            )}
                            {item.editedAt && <span>змінено</span>}
                            <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                              {formatChatTime(item.createdAt)}
                            </time>
                          </footer>
                        )}
                        {editingComment?.id !== item.id && (
                          openCommentMenu?.id === item.id && (
                              <div
                                className="task-comment-action-menu"
                                role="menu"
                                aria-label="Дії з повідомленням"
                                style={{ left: openCommentMenu.left, top: openCommentMenu.top }}
                                onMouseEnter={keepCommentMenuOpen}
                                onMouseLeave={delayCommentMenuClose}
                              >
                                <button
                                  type="button"
                                  disabled={reactToComment.isPending}
                                  onClick={() => {
                                    closeCommentMenu()
                                    reactToComment.mutate(item)
                                  }}
                                >
                                  <Heart size={14} /> {item.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    closeCommentMenu()
                                    setReplyTo({
                                      id: item.id,
                                      authorName: item.author.displayName,
                                      body: item.body,
                                    })
                                  }}
                                >
                                  <Reply size={14} /> Відповісти
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    closeCommentMenu()
                                    void navigator.clipboard.writeText(item.body)
                                      .then(() => setContentMessage('Текст повідомлення скопійовано.'))
                                      .catch(() => setContentMessage('Не вдалося скопіювати текст повідомлення.'))
                                  }}
                                >
                                  <Copy size={14} /> Копіювати текст
                                </button>
                                {item.canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      closeCommentMenu()
                                      setEditingComment({
                                        id: item.id,
                                        body: item.body,
                                        mentions: item.mentions.map((mention) => ({
                                          userId: mention.userId,
                                          start: mention.start,
                                          end: mention.end,
                                          label: item.body.slice(mention.start + 1, mention.end),
                                        })),
                                      })
                                    }}
                                  >
                                    <Pencil size={14} /> Редагувати
                                  </button>
                                )}
                                {item.canDelete && (
                                  <button
                                    type="button"
                                    className="is-danger"
                                    disabled={deleteComment.isPending}
                                    onClick={() => {
                                      if (!window.confirm('Видалити це повідомлення?')) return
                                      closeCommentMenu()
                                      deleteComment.mutate({ commentId: item.id, expectedVersion: item.version })
                                    }}
                                  >
                                    <Trash2 size={14} /> Видалити
                                  </button>
                                )}
                              </div>
                            )
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : activity.isLoading ? (
              <Skeleton rows={2} />
            ) : (
              <p className="muted">Ще немає повідомлень. Додайте перше корисне уточнення.</p>
            )}
            {activity.isFetchingNextPage && <div className="task-discussion__older">Завантажуємо давнішу історію…</div>}
            </div>
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
              <MessageComposerFrame
                className="task-comment-composer"
                reply={replyTo && (
                  <div className="message-composer__reply">
                    <span>
                      <strong>Відповідь: {replyTo.authorName}</strong>
                      <small>{replyTo.body.slice(0, 120)}</small>
                    </span>
                    <button type="button" aria-label="Скасувати відповідь" onClick={() => setReplyTo(null)}>
                      <X size={17} />
                    </button>
                  </div>
                )}
                attachments={commentAttachmentIds.length > 0 && (
                  <div className="message-composer__attachments" aria-label="Файли коментаря">
                    {commentAttachmentIds.map((fileId) => {
                      const attachment = query.data.attachments.find((item) => item.id === fileId)
                      const fileName = attachment?.fileName ?? 'Новий файл'
                      return (
                        <span key={fileId}>
                          <FileText size={15} />
                          {fileName}
                          <button
                            type="button"
                            aria-label={`Прибрати ${fileName} з коментаря`}
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
                leadingActions={(
                  <>
                    <input
                      ref={commentFileInputRef}
                      type="file"
                      hidden
                      multiple
                      disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                      onChange={(event) => {
                        void uploadFiles(
                          [...event.target.files ?? []].slice(0, 5 - commentAttachmentIds.length),
                          true,
                        )
                        event.currentTarget.value = ''
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Додати файли"
                      title="Додати файли або перетягнути їх у поле вводу"
                      disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                      onClick={() => commentFileInputRef.current?.click()}
                    >
                      <Paperclip size={21} />
                    </button>
                    <button
                      type="button"
                      aria-label="Прикріпити з Диска"
                      title="Прикріпити файл із Диска"
                      disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                      onClick={() => setDrivePickerOpen(true)}
                    >
                      <HardDrive size={20} />
                    </button>
                  </>
                )}
                input={(
                  <MentionTextarea
                    className="message-composer__input"
                    label="Коментар до завдання"
                    value={comment}
                    mentions={commentMentions}
                    candidateUrl={`/tasks/${id}/mention-candidates`}
                    onTextareaRef={(element) => { commentTextareaRef.current = element }}
                    onChange={(value, mentions) => {
                      setComment(value)
                      setCommentMentions(mentions)
                    }}
                    rows={1}
                    maxLength={4000}
                    visuallyHiddenLabel
                    placeholder={replyTo ? 'Напишіть коротку відповідь…' : 'Напишіть повідомлення…'}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }}
                  />
                )}
                sendAction={(
                  <button
                    type="submit"
                    className="message-composer__send"
                    aria-label="Надіслати"
                    disabled={(
                      !comment.trim()
                      || post.isPending
                      || uploadAttachment.isPending
                      || attachDriveFile.isPending
                    )}
                  >
                    <Send size={20} />
                  </button>
                )}
              />
              {drivePickerOpen && (
                <DrivePicker
                  onPick={(attachment) => attachDriveFile.mutate(attachment.id)}
                  onClose={() => setDrivePickerOpen(false)}
                />
              )}
            </form>
          </section>
          </div>
          <aside className="task-detail-sidebar" aria-label="Керування завданням">
          <section className="task-detail-status-card" aria-labelledby={`task-status-${id}`}>
            <header>
              <span className="task-detail-card-icon"><CalendarDays size={18} /></span>
              <h3 id={`task-status-${id}`}>Статус і строки</h3>
              <div className="task-detail-status-card__accent">
                <StatusBadge status={query.data.status} />
              </div>
            </header>
            <dl>
              <div>
                <dt>Створено</dt>
                <dd>{formatDateTime(query.data.createdAt)}</dd>
              </div>
              <div>
                <dt>Строк</dt>
                <dd>{query.data.deadline ? formatDateTime(query.data.deadline) : 'Без строку'}</dd>
              </div>
              <div>
                <dt>Оновлено</dt>
                <dd>{formatDateTime(query.data.updatedAt)}</dd>
              </div>
              <div>
                <dt>Пріоритет</dt>
                <dd>{taskPriorityLabel(query.data.priority)}</dd>
              </div>
            </dl>
          </section>
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
                  {query.data.personalState.reminders.length > 0 && (
                    <small>{query.data.personalState.reminders.length}</small>
                  )}
                </header>
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
                    Запланувати
                  </Button>
                </form>
              </section>
              {canManageTask && !query.data.parentTaskId && <section className="task-recurrence">
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
                  <input name="firstOccurrenceAt" type="datetime-local" required />
                </label>
                <label>
                  До дати
                  <input name="until" type="datetime-local" />
                </label>
                <Button variant="secondary" disabled={recurrence.isPending}>
                  Запланувати
                </Button>
              </form>
              </section>}
              {recurrenceMessage && <p className="success-note">{recurrenceMessage}</p>}
            </div>
          </details>
          <details className="task-detail-disclosure" data-task-section="checklist">
          <summary aria-label="Чек-лист">
            <span className="task-detail-card-icon"><ListChecks size={18} /></span>
            <span>
              <strong>Чек-лист</strong>
              <small>{query.data.checklist.length ? `${query.data.checklist.filter((item) => item.isDone).length} із ${query.data.checklist.length} виконано` : 'Конкретні кроки до результату'}</small>
            </span>
            <ChevronDown size={18} />
          </summary>
          <div className="task-detail-disclosure__body">
          <section>
            {query.data.checklist?.length ? (
              <div className="checklist">
                {query.data.checklist.map((item) => (
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
          <details
            className="task-detail-disclosure task-detail-links"
            data-task-section="subtasks"
            open={linksOpen}
            onToggle={(event) => setLinksOpen(event.currentTarget.open)}
          >
            <summary aria-label={`${linksOpen ? 'Згорнути' : 'Розгорнути'} секцію «Зв’язки»`}>
              <span className="task-detail-card-icon"><Link2 size={18} /></span>
              <span>
                <strong>Зв’язки</strong>
                <small>
                  {query.data.parent || query.data.subtasks.length
                    ? `${(query.data.parent ? 1 : 0) + query.data.subtasks.length} пов’язаних завдань`
                    : 'Батьківське завдання та підзавдання'}
                </small>
              </span>
              <ChevronDown size={18} />
            </summary>
            <div className="task-detail-disclosure__body">
            <section className="task-subtasks" aria-labelledby={`task-subtasks-${id}`}>
              <header>
                <div>
                  <h3 id={`task-subtasks-${id}`}>Ієрархія завдання</h3>
                  <p>
                    {query.data.subtaskProgress.total
                      ? `${query.data.subtaskProgress.done} із ${query.data.subtaskProgress.total} завершено`
                      : 'Розбийте результат на окремі відповідальні кроки.'}
                  </p>
                </div>
                {canManageTask && query.data.canCreateSubtask && (
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
              {query.data.parent && (
                <Link
                  className="task-parent-link"
                  to={`/tasks/${query.data.parent.id}${location.search}`}
                >
                  <ArrowLeft size={15} />
                  До батьківського завдання · {query.data.parent.number}
                </Link>
              )}
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
                      <option value={query.data.assignee.id}>
                        {query.data.assignee.displayName}
                      </option>
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
            </div>
          </details>
          <div className="task-detail-roles" data-task-section="participants">
            <TaskSingleRoleCard
              label="Постановник"
              person={query.data.reporter}
            />
            <TaskSingleRoleCard
              label="Відповідальний"
              person={query.data.assignee}
              employees={employees.data?.items ?? []}
              canChange={editOpen && query.data.canReassign && query.data.status !== 'IN_REVIEW'}
              onChange={(userId) => reassignResponsible.mutate(userId)}
            />
            <TaskParticipantGroup
              label="Співвиконавці"
              emptyLabel="Співвиконавців ще немає"
              participants={query.data.coExecutors}
              role="CO_EXECUTOR"
              canEdit={editOpen && canManageTask && query.data.canManageParticipants}
              employees={employees.data?.items ?? []}
              excludedUserIds={[
                query.data.assignee.id,
                query.data.reporter.id,
                ...query.data.coExecutors.map((participant) => participant.user.id),
              ]}
              addPending={addParticipant.isPending}
              removePending={removeParticipant.isPending}
              onAdd={(userId) => addParticipant.mutate({
                userId,
                role: 'CO_EXECUTOR',
                expectedVersion: query.data.version,
              })}
              onRemove={(userId) => removeParticipant.mutate({
                userId,
                role: 'CO_EXECUTOR',
                expectedVersion: query.data.version,
              })}
            />
            <TaskParticipantGroup
              label="Спостерігачі"
              emptyLabel="Спостерігачів ще немає"
              participants={query.data.observers}
              role="OBSERVER"
              canEdit={editOpen && canManageTask && query.data.canManageParticipants}
              employees={employees.data?.items ?? []}
              excludedUserIds={[
                query.data.assignee.id,
                query.data.reporter.id,
                ...query.data.observers.map((participant) => participant.user.id),
              ]}
              addPending={addParticipant.isPending}
              removePending={removeParticipant.isPending}
              onAdd={(userId) => addParticipant.mutate({
                userId,
                role: 'OBSERVER',
                expectedVersion: query.data.version,
              })}
              onRemove={(userId) => removeParticipant.mutate({
                userId,
                role: 'OBSERVER',
                expectedVersion: query.data.version,
              })}
            />
            {participantMessage && (
              <p className="task-participant-message" aria-live="polite">{participantMessage}</p>
            )}
          </div>
          </aside>
        </div>
        )}
      </TaskDetailLayout>
      <UnsavedChangesDialog
        guard={closeGuard}
        title="Повернутися до списку завдань?"
        description="Незбережені зміни в завданні буде втрачено."
      />
    </>
  )
}

function TaskDetailLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="task-detail-page">
      <PageHeader title={title} />
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
  const [previewOpen, setPreviewOpen] = useState(false)
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
      {scanStatus === 'CLEAN' && <Eye size={15} />}
    </>
  )
  if (scanStatus === 'CLEAN') {
    return (
      <>
        <button
          type="button"
          className={compact ? 'task-attachment is-compact' : 'task-attachment'}
          aria-label={`Переглянути ${attachment.fileName}`}
          onClick={() => setPreviewOpen(true)}
        >
          {content}
        </button>
        {previewOpen && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
      </>
    )
  }
  return (
    <span className={compact ? 'task-attachment is-compact' : 'task-attachment'}>
      {content}
    </span>
  )
}

function TaskSingleRoleCard({
  label,
  person,
  employees = [],
  canChange = false,
  onChange,
}: {
  label: 'Постановник' | 'Відповідальний'
  person: TaskDetailView['reporter']
  employees?: Employee[]
  canChange?: boolean
  onChange?: (userId: string) => void
}) {
  const headingId = label === 'Постановник' ? 'task-reporter' : 'task-responsible'
  return (
    <section className="task-role-card task-role-card--single" aria-labelledby={headingId}>
      <header>
        <span className="task-role-card__icon"><User size={18} /></span>
        <h3 id={headingId}>{label}</h3>
      </header>
      <UserProfileLink className="task-role-card__person" userId={person.id}>
        <Avatar size="sm" name={person.displayName} src={person.avatarAsset} />
        <strong>{person.displayName}</strong>
      </UserProfileLink>
      {canChange && onChange && (
          <AsyncTaskCombobox
            label="Змінити відповідального"
            value=""
            clearOnSelect
            placeholder="Почніть вводити ім’я"
            loadOptions={async (search) => {
              const query = search.trim().toLocaleLowerCase('uk')
              return employees
                .filter((employee) => employee.id !== person.id)
                .filter((employee) => `${employee.displayName} ${employee.jobTitle}`.toLocaleLowerCase('uk').startsWith(query))
                .map((employee) => ({ id: employee.id, label: employee.displayName, detail: employee.jobTitle }))
            }}
            onChange={(userId) => { if (userId) onChange(userId) }}
          />
      )}
    </section>
  )
}

function TaskParticipantGroup({
  label,
  emptyLabel,
  participants,
  role,
  canEdit,
  employees,
  excludedUserIds,
  addPending,
  removePending,
  onAdd,
  onRemove,
}: {
  label: string
  emptyLabel: string
  participants: TaskDetailView['coExecutors']
  role: TaskParticipantRole
  canEdit: boolean
  employees: Employee[]
  excludedUserIds: string[]
  addPending: boolean
  removePending: boolean
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
}) {
  const headingId = `task-role-${role.toLowerCase()}`
  const availableEmployees = employees.filter((employee) => !excludedUserIds.includes(employee.id))
  const [selectedUserId, setSelectedUserId] = useState('')
  return (
    <section className="task-role-card task-role-group" aria-labelledby={headingId}>
      <header>
        <span className="task-role-card__icon"><Users size={18} /></span>
        <h3 id={headingId}>{label}</h3>
        <small className="task-detail-count">{participants.length}</small>
      </header>
      {participants.length ? (
        <div className="task-role-people">
          {participants.map((participant) => (
            <div className="task-person-chip" key={participant.id}>
              <UserProfileLink className="task-person-chip__profile" userId={participant.user.id}>
                <Avatar
                  size="sm"
                  name={participant.user.displayName}
                  src={participant.user.avatarAsset}
                />
                <strong>{participant.user.displayName}</strong>
              </UserProfileLink>
              {canEdit && (
                <button
                  type="button"
                  className="task-participant-remove"
                  aria-label={`Вилучити ${participant.user.displayName} з ролі «${label}»`}
                  disabled={removePending}
                  onClick={() => onRemove(participant.user.id)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="task-role-card__empty">{emptyLabel}</p>
      )}
      {canEdit && (
        <form
          className="task-role-card__add"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selectedUserId) return
            onAdd(selectedUserId)
            setSelectedUserId('')
          }}
        >
          <AsyncTaskCombobox
            label={`Додати: ${label.toLowerCase()}`}
            value={selectedUserId}
            placeholder="Почніть вводити ім’я"
            loadOptions={async (search) => {
              const query = search.trim().toLocaleLowerCase('uk')
              return availableEmployees
                .filter((employee) => `${employee.displayName} ${employee.jobTitle}`.toLocaleLowerCase('uk').startsWith(query))
                .map((employee) => ({ id: employee.id, label: employee.displayName, detail: employee.jobTitle }))
            }}
            onChange={setSelectedUserId}
          />
          <Button
            type="submit"
            variant="secondary"
            aria-label={`Додати учасника до ролі «${label}»`}
            disabled={addPending || !availableEmployees.length || !selectedUserId}
          >
            <UserPlus size={16} />
            Додати
          </Button>
        </form>
      )}
    </section>
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
    && !['DONE', 'ARCHIVED'].includes(task.status),
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
