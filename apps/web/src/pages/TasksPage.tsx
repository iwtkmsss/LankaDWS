import { DateTimePicker } from '../shared/ui/DateTimePicker'
import { personName } from '../shared/lib/personName'
import { FormattedTextarea } from '../shared/text/FormattedTextarea'
import { useEntityNotificationRead } from '../features/notifications/useEntityNotificationRead'
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
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
  ArrowUp,
  ArrowDown,
  Bell,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Copy,
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Flag,
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
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { DrivePicker } from '../features/drive/DrivePicker'
import { useDiscardDraftAttachment } from '../shared/files/useDiscardDraftAttachment'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { TaskListColumnsControl, useTaskListColumnsPreference } from '../features/tasks/list/TaskListColumns'
import { TaskStatusPicker } from '../features/tasks/list/TaskStatusPicker'
import { TaskStatusFilters } from '../features/tasks/list/TaskStatusFilters'
import { readTaskStatusFilter, writeTaskStatusFilter } from '../features/tasks/list/task-status-filters'
import { FormattedText } from '../shared/text/FormattedText'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../shared/mentions/mentionText'
import { MessageComposerFrame } from '../shared/messages/MessageComposerFrame'
import { formatChatTime } from '../features/messages/lib/chatDates'
import { usePreservedChatScroll } from '../features/messages/hooks/usePreservedChatScroll'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import { FileFormatIcon } from '../shared/files/FileThumbnail'
import { officeFileFormat } from '../shared/files/filePreview'
import { SaveToDriveButton } from '../shared/files/SaveToDriveButton'
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


export default function TasksPage() {
  const { taskId } = useParams()
  return taskId ? <TaskDetailPage id={taskId} /> : <TasksListPage />
}

function TasksListPage() {
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
  const [filtersOpen, setFiltersOpen] = useState(false)
  const legacyTab = params.get('tab')
  const personalRoles: TaskViewRole[] = ['RESPONSIBLE', 'CO_EXECUTOR', 'CREATOR', 'OBSERVER']
  const requestedRoles = (params.get('role')
    ?? (legacyTab === 'created' ? 'CREATOR' : legacyTab === 'all' ? 'ALL' : 'RESPONSIBLE'))
    .split(',').filter((value): value is TaskViewRole => personalRoles.includes(value as TaskViewRole)
      || value === 'ALL')
  const selectedRoles: TaskViewRole[] = !requestedRoles.length || requestedRoles.includes('ALL') ? ['ALL'] : requestedRoles
  const selectedRoleKey = selectedRoles.join(',')
  const role = selectedRoleKey === 'ALL' && user?.accountType !== 'ADMIN' ? personalRoles.join(',') : selectedRoleKey
  const roleButtons = useRef(new Map<TaskViewRole, HTMLButtonElement>())
  const pendingRoleFocus = useRef<TaskViewRole | null>(null)
  useEffect(() => {
    if (pendingRoleFocus.current) roleButtons.current.get(pendingRoleFocus.current)?.focus()
    pendingRoleFocus.current = null
  }, [selectedRoleKey])
  const sort = params.get('sort') ?? ''
  const direction = params.get('direction') === 'desc' ? 'desc' : 'asc'
  const page = Number(params.get('page') ?? 1)
  const search = params.get('search') ?? ''
  const statusFilter = readTaskStatusFilter(params)
  const { status, preset } = statusFilter
  const priority = params.get('priority') ?? ''
  const favorite = params.get('favorite') ?? ''
  const important = params.get('important') ?? ''
  const overdue = params.get('overdue') === 'true'
  const dueFrom = params.get('dueFrom') ?? ''
  const dueTo = params.get('dueTo') ?? ''
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
    preset: preset === 'ALL' ? '' : preset,
    dueFrom,
    dueTo,
    assigneeId,
    creatorId,
    coExecutorId,
    observerId,
    sort,
    direction,
  })
  const query = useQuery({
    queryKey: [
      'tasks',
      user?.id,
      sort,
      direction,
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
      assigneeId,
      creatorId,
      coExecutorId,
      observerId,
    ],
    queryFn: () => api<PageResult<TaskListItem>>(`/tasks?${queryString.toString()}`),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === user?.id ? previous : undefined,
  })
  const countFilters = new URLSearchParams(queryString)
  countFilters.delete('sort')
  countFilters.delete('direction')
  countFilters.delete('role')
  countFilters.set('page', '1')
  const countRoles: TaskViewRole[] = [...personalRoles, 'ALL']
  const roleCounts = useQueries({
    queries: countRoles.map((countRole) => ({
      queryKey: ['tasks', 'role-count', user?.id, countRole, countFilters.toString()],
      queryFn: () => {
        const filters = new URLSearchParams(countFilters)
        filters.set('role', countRole === 'ALL' && user?.accountType !== 'ADMIN' ? personalRoles.join(',') : countRole)
        return api<PageResult<TaskListItem>>(`/tasks?${filters}`)
      },
      enabled: Boolean(user) && countRole !== role,
    })),
  })
  const liveCountForRole = (countRole: TaskViewRole) => countRole === role
    ? query.data?.total ?? roleCounts[countRoles.indexOf(countRole)]?.data?.total
    : roleCounts[countRoles.indexOf(countRole)]?.data?.total
  const [lastRoleCounts, setLastRoleCounts] = useState<{
    userId: string | undefined
    values: Partial<Record<TaskViewRole, number>>
  }>({ userId: user?.id, values: {} })
  useEffect(() => {
    setLastRoleCounts((previous) => {
      const values = previous.userId === user?.id ? { ...previous.values } : {}
      countRoles.forEach((countRole) => {
        const count = liveCountForRole(countRole)
        if (count !== undefined) values[countRole] = count
      })
      return previous.userId === user?.id && countRoles.every((countRole) => previous.values[countRole] === values[countRole])
        ? previous : { userId: user?.id, values }
    })
  }, [roleCounts, query.data?.total, role, user?.id])
  const countForRole = (countRole: TaskViewRole) => liveCountForRole(countRole)
    ?? (lastRoleCounts.userId === user?.id ? lastRoleCounts.values[countRole] : undefined)
  const taskListColumns = useTaskListColumnsPreference()
  const columnWidths = { reporter: 200, responsibles: 220, dueDate: 140, status: 150, priority: 120, subtaskProgress: 110, activity: 120 }
  const orderedColumns = (['reporter', 'responsibles', 'dueDate', 'status', 'priority', 'subtaskProgress', 'activity'] as const)
    .filter((column) => taskListColumns.visible.includes(column))
  const activeFilterCount = [search.trim(), status, priority, personalFilter,
    preset !== 'ALL' ? preset : '', dueFrom, dueTo, assigneeId, creatorId, coExecutorId, observerId].filter(Boolean).length
  const listHasFilters = activeFilterCount > 0
  const emptyState = listHasFilters ? {
    title: status === 'DONE' ? 'Виконаних завдань за цими фільтрами немає' : 'За вибраними фільтрами завдань немає',
    description: 'Оберіть «Усі статуси», «Виконані» або змініть додаткові фільтри.',
  } : taskRoleEmptyState(selectedRoles.length === 1 ? selectedRoles[0]! : 'ALL')
  const roleItems = [
    { value: 'RESPONSIBLE', label: 'Виконавець' },
    { value: 'CO_EXECUTOR', label: 'Співвиконавець' },
    { value: 'OBSERVER', label: 'Спостерігач' },
    { value: 'CREATOR', label: 'Постановник' },
    { value: 'ALL', label: 'Усі доступні' },
  ] as Array<{ value: TaskViewRole; label: string }>
  const renderRole = (item: typeof roleItems[number]) => {
    const count = countForRole(item.value)
    const selected = selectedRoles.includes(item.value)
    return <button key={item.value} type="button" aria-pressed={selected}
      ref={(node) => { if (node) roleButtons.current.set(item.value, node); else roleButtons.current.delete(item.value) }}
      onClick={() => {
        pendingRoleFocus.current = item.value
        updateParams((current) => {
          const currentRoles = (current.get('role') ?? selectedRoleKey).split(',').filter((value) => value && value !== 'ALL')
          const nextRoles = item.value === 'ALL' ? ['ALL'] : currentRoles.includes(item.value)
            ? currentRoles.filter((value) => value !== item.value) : [...currentRoles, item.value]
          current.set('role', nextRoles.length ? nextRoles.join(',') : 'ALL')
          current.delete('tab')
          current.delete('page')
        })
      }}>
      {item.label}{count !== undefined && <span className="task-role-count">{count}</span>}
    </button>
  }
  const renderSortHeader = (key: string, label: string) => <th aria-sort={sort === key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" onClick={() => updateParams((current) => {
      current.set('sort', key)
      current.set('direction', sort === key && direction === 'asc' ? 'desc' : 'asc')
      current.delete('page')
    })}>{label}{sort === key && (direction === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}</button>
  </th>
  return (
    <div>
      <PageHeader
        title="Завдання"
        description="Завдання за вибраними ролями. Найближчі строки — першими."
        action={(
          <Link className="button button--primary" to="/tasks/new">
            <Plus size={17} />
            Створити завдання
          </Link>
        )}
      />
      <Card className="list-card task-list-card">
        <div className="list-toolbar">
          <div className="task-role-filters" role="group" aria-label="Мої ролі в завданнях">
            <span className="task-filter-selection__label">Я:</span>
            <div className="task-filter-selection" role="group" aria-label="Вибрані ролі">
              {roleItems.filter((item) => selectedRoles.includes(item.value)).map(renderRole)}
            </div>
            {roleItems.filter((item) => !selectedRoles.includes(item.value)).map(renderRole)}
          </div>
          <div className="toolbar-actions">
            <button className="task-search-toggle" aria-expanded={filtersOpen} aria-label={`Пошук і фільтри${activeFilterCount ? ` · ${activeFilterCount}` : ''}`}
              onClick={() => setFiltersOpen((value) => !value)}>
              <Search size={17} />
              Пошук і фільтри
              <span className="task-filter-count">{activeFilterCount ? ` · ${activeFilterCount}` : ''}</span>
            </button>
            <TaskListColumnsControl controller={taskListColumns} />
          </div>
        </div>
        <div className="task-preset-toolbar">
          <TaskStatusFilters group={statusFilter.group} selected={statusFilter.selected}
            onChange={(group, selected) => updateParams((current) => writeTaskStatusFilter(current, group, selected))} />
        </div>
        {filtersOpen && (
          <div className="filter-panel task-advanced-filters">
            <div className="task-advanced-filters__toolbar">
              <label className="task-advanced-filters__field">
                <span className="task-filter-field-label"><Search size={14} aria-hidden="true" />Пошук завдання</span>
                <span className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Пошук завдань"
                    autoFocus
                    placeholder="Назва або номер завдання"
                    value={search}
                    onChange={(event) =>
                      updateParams((current) => {
                        if (event.target.value) current.set('search', event.target.value)
                        else current.delete('search')
                        current.delete('page')
                      })
                    }
                  />
                </span>
              </label>
              <label>
                <span className="task-filter-field-label"><Bookmark size={14} aria-hidden="true" />Збережені фільтри</span>
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
              <label className="task-advanced-filters__field">
                <span className="task-filter-field-label"><CirclePlus size={14} aria-hidden="true" />Додати фільтр</span>
                <input
                  aria-label="Назва фільтра"
                  value={viewName}
                  maxLength={80}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="Назва фільтра"
                />
              </label>
              <div className="task-advanced-filters__actions">
                <Button
                  variant="secondary"
                  disabled={!viewName.trim() || saveView.isPending}
                  onClick={() => saveView.mutate(viewName.trim())}
                >
                  <Bookmark size={15} />
                  Зберегти
                </Button>
                <Button
                  variant="secondary"
                  className="task-filters-clear"
                  disabled={!listHasFilters && selectedRoleKey === 'RESPONSIBLE'}
                  onClick={() =>
                    updateParams((current) => {
                      current.delete('role')
                      current.delete('tab')
                      current.delete('search')
                      current.delete('status')
                      current.delete('priority')
                      current.delete('favorite')
                      current.delete('important')
                      current.delete('overdue')
                      current.delete('preset')
                      current.delete('statusGroup')
                      current.delete('dueFrom')
                      current.delete('dueTo')
                      current.delete('assigneeId')
                      current.delete('creatorId')
                      current.delete('coExecutorId')
                      current.delete('observerId')
                      current.delete('page')
                    })
                  }
                >
                  <Trash2 size={15} aria-hidden="true" />
                  Очисти фільтри
                </Button>
              </div>
            </div>
            <label>
              <span className="task-filter-field-label"><CalendarDays size={14} aria-hidden="true" />Від дати</span>
              <DateTimePicker
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
              <span className="task-filter-field-label"><CalendarDays size={14} aria-hidden="true" />До дати</span>
              <DateTimePicker
                type="date"
                value={dueTo}
                onChange={(event) => updateParams((current) => {
                  if (event.target.value) current.set('dueTo', event.target.value)
                  else current.delete('dueTo')
                  current.delete('page')
                })}
              />
            </label>
            <div className="task-status-picker">
              <span className="task-status-picker__label task-filter-field-label"><CheckCircle2 size={14} aria-hidden="true" />Статус</span>
              <TaskStatusPicker selected={statusFilter.selected}
                onChange={(selected) => updateParams((current) => writeTaskStatusFilter(current, 'ALL', selected))} />
            </div>
            <label>
              <span className="task-filter-field-label"><Flag size={14} aria-hidden="true" />Пріоритет</span>
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
            <div className="task-filter-user-field"><Users size={14} aria-hidden="true" /><UserSearchCombobox
              label="Відповідальний"
              value={assigneeId}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('assigneeId', value)
                else current.delete('assigneeId')
                current.delete('page')
              })}
            /></div>
            <div className="task-filter-user-field"><Users size={14} aria-hidden="true" /><UserSearchCombobox
              label="Постановник"
              value={creatorId}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('creatorId', value)
                else current.delete('creatorId')
                current.delete('page')
              })}
            /></div>
            <div className="task-filter-user-field"><Users size={14} aria-hidden="true" /><UserSearchCombobox
              label="Співвиконавець"
              value={coExecutorId}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('coExecutorId', value)
                else current.delete('coExecutorId')
                current.delete('page')
              })}
            /></div>
            <div className="task-filter-user-field"><Users size={14} aria-hidden="true" /><UserSearchCombobox
              label="Спостерігач"
              value={observerId}
              onChange={(value) => updateParams((current) => {
                if (value) current.set('observerId', value)
                else current.delete('observerId')
                current.delete('page')
              })}
            /></div>

          </div>
        )}
        {query.isLoading ? (
          <PageDataLoader />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="responsive-table task-list-table-wrap">
            <table className="task-list-table" aria-busy={query.isFetching}
              style={{ minWidth: 320 + orderedColumns.reduce((sum, column) => sum + columnWidths[column], 0) }}>
              <colgroup>
                <col />
                {orderedColumns.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
              </colgroup>
              <thead>
                <tr>
                  {renderSortHeader('title', 'Завдання')}
                  {taskListColumns.visible.includes('reporter') && renderSortHeader('reporter', 'Постановник')}
                  {taskListColumns.visible.includes('responsibles') && renderSortHeader('responsibles', 'Виконавці')}
                  {taskListColumns.visible.includes('dueDate') && renderSortHeader('dueDate', 'Строк')}
                  {taskListColumns.visible.includes('status') && renderSortHeader('status', 'Статус')}
                  {taskListColumns.visible.includes('priority') && renderSortHeader('priority', 'Пріоритет')}
                  {taskListColumns.visible.includes('subtaskProgress') && renderSortHeader('subtaskProgress', 'Підзадачі')}
                  {taskListColumns.visible.includes('activity') && renderSortHeader('activity', 'Активність')}
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
                            № {task.number}
                            {task.parentTaskId ? ' · Підзадача' : ''}
                          </small>
                        </span>
                      </Link>
                    </td>
                    {taskListColumns.visible.includes('reporter') && <td data-label="Постановник"><UserProfileLink className="person-cell" userId={task.reporter.id}><Avatar size="sm" name={personName(task.reporter.displayName)} src={task.reporter.avatarAsset} />{personName(task.reporter.displayName)}</UserProfileLink></td>}
                    {taskListColumns.visible.includes('responsibles') && <td data-label="Виконавці">
                      {task.responsibles.length ? (
                        <span className="person-cell task-responsibles">
                          {task.responsibles.map((responsible) => (
                            <UserProfileLink
                              className="task-list-person"
                              key={responsible.id}
                              userId={responsible.id}
                            >
                              <Avatar size="sm" name={personName(responsible.displayName)} src={responsible.avatarAsset} />
                              {personName(responsible.displayName)}
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
                    {taskListColumns.visible.includes('priority') && <td data-label="Пріоритет">{taskPriorityLabel(task.priority)}</td>}
                    {taskListColumns.visible.includes('subtaskProgress') && <td data-label="Підзадачі">{task.subtaskProgress.total ? 'Так' : 'Ні'}</td>}
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
            title={emptyState.title}
            description={emptyState.description}
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
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [delegateId, setDelegateId] = useState('')
  const [delegateError, setDelegateError] = useState('')
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
  const [commentAttachments, setCommentAttachments] = useState<TaskAttachmentView[]>([])
  const commentAttachmentIds = commentAttachments.map((attachment) => attachment.id)
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const commentFileRemoval = useDiscardDraftAttachment((fileId) => {
    setCommentAttachments((current) => current.filter((item) => item.id !== fileId))
  })
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
  const actionsMenuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeMenu = () => {
      if (actionsMenuRef.current) actionsMenuRef.current.open = false
      setActionsOpen(false)
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsMenuRef.current?.contains(event.target)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !actionsMenuRef.current?.open) return
      closeMenu()
      actionsMenuRef.current?.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
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
  useEntityNotificationRead('TASK', query.isSuccess ? id : undefined, query.dataUpdatedAt)

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
  const delegateTask = useMutation({
    mutationFn: () => api(`/tasks/${id}/delegate`, { method: 'POST', body: jsonBody({ userId: delegateId, expectedVersion: query.data?.version }) }),
    onSuccess: () => {
      setDelegateOpen(false)
      setDelegateId('')
      setDelegateError('')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => setDelegateError('Не вдалося делегувати завдання. Оновіть сторінку та перевірте доступ.'),
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
      return api<TaskAttachmentView>(`/tasks/${id}/attachments${input.selectForComment ? '?draft=true' : ''}`, {
        method: 'POST',
        body,
      })
    },
    onSuccess: (attachment, input) => {
      if (input.selectForComment) {
        setCommentAttachments((current) => (
          current.some((item) => item.id === attachment.id)
            ? current
            : [...current, attachment].slice(0, 5)
        ))
        return
      }
      setContentMessage('Файл додано. Він відкриється після безпечної перевірки.')
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
      setCommentAttachments((current) => current.filter((attachment) => attachment.id !== fileId))
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
        setCommentAttachments([])
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
    mutationFn: (fileId: string) => api<TaskAttachmentView>(`/tasks/${id}/attachments/from-drive?draft=true`, {
      method: 'POST',
      body: jsonBody({ fileId }),
    }),
    onSuccess: (attachment) => {
      setCommentAttachments((current) => (
        current.some((item) => item.id === attachment.id) ? current : [...current, attachment].slice(0, 5)
      ))
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
              <FormattedText body={query.data.description || 'Опис не додано.'} />
            </div>
            <div className="task-detail-heading-actions">
              {query.data.availableStatusActions.length > 0 && (
                <div className="task-detail-status-actions">
                  {query.data.availableStatusActions.includes('START') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'START', expectedVersion: query.data.version })}><Play size={16} />Почати роботу</Button>}
                  {query.data.availableStatusActions.includes('COMPLETE') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'COMPLETE', expectedVersion: query.data.version })}><CheckCircle2 size={16} />Завершити</Button>}
                  {query.data.availableStatusActions.includes('APPROVE') && <Button type="button" disabled={status.isPending} onClick={() => status.mutate({ action: 'APPROVE', expectedVersion: query.data.version })}><CheckCircle2 size={16} />Прийняти</Button>}
                  {query.data.status !== 'DONE' && query.data.availableStatusActions.includes('RETURN_TO_WORK') && <Button type="button" variant="secondary" disabled={status.isPending} onClick={() => {
                    const note = window.prompt('Коментар для відповідального (необов’язково):')
                    if (note !== null) status.mutate({ action: 'RETURN_TO_WORK', expectedVersion: query.data.version, note })
                  }}><RotateCcw size={16} />Повернути в роботу</Button>}
                </div>
              )}
              <details
                ref={actionsMenuRef}
                className="task-detail-actions-menu"
                open={actionsOpen}
                onToggle={(event) => setActionsOpen(event.currentTarget.open)}
              >
                <summary aria-label="Дії із завданням">
                  <MoreHorizontal size={20} />
                </summary>
                <div role="menu">
                <button type="button" role="menuitem" onClick={() => navigate(`/tasks/new?copyFrom=${encodeURIComponent(id)}`)}><Copy size={16} />Копіювати задачу</button>
                {query.data.status === 'DONE' && query.data.availableStatusActions.includes('RETURN_TO_WORK') && <button type="button" role="menuitem" disabled={status.isPending} onClick={() => { setActionsOpen(false); status.mutate({ action: 'RETURN_TO_WORK', expectedVersion: query.data.version }) }}><RotateCcw size={16} />Відновити завдання</button>}
                {(query.data.canReassign || query.data.assignee.id === user?.id) && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setDelegateError(''); setDelegateOpen(true) }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 13h7m-3-3 3 3-3 3" /><circle cx="16" cy="6" r="3" /><path d="M11 21v-2a5 5 0 0 1 10 0v2" /></svg>Делегувати</button>}
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
          {delegateOpen && <form className="task-edit-form" onSubmit={(event) => { event.preventDefault(); delegateTask.mutate() }}>
            <UserSearchCombobox label="Новий відповідальний" value={delegateId} onChange={setDelegateId} excludeIds={[query.data.assignee.id]} />
            <p className="muted">Попередній відповідальний залишиться спостерігачем завдання.</p>
            {delegateError && <p role="alert">{delegateError}</p>}
            <div className="form-actions"><Button type="button" variant="ghost" onClick={() => setDelegateOpen(false)}>Скасувати</Button><Button disabled={!delegateId || delegateTask.isPending}>Делегувати</Button></div>
          </form>}
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
              <div className="span-2"><FormattedTextarea label="Опис"
                  name="description"
                  defaultValue={query.data.description}
                  rows={4}
                  maxLength={20000}
                  placeholder="Контекст і критерій готовності"
                />
              </div>
              <input type="hidden" name="assigneeId" value={query.data.assignee.id} />
              {query.data.canTransferCreator && (
                <UserSearchCombobox
                  label="Постановник"
                  name="creatorId"
                  defaultUser={query.data.creator}
                />
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
                  <DateTimePicker
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
                <Button disabled={updateTask.isPending}>
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
                        <TaskAttachment attachment={attachment} actions />
                        {attachment.canRemove && (
                          <button
                            type="button"
                            aria-label={`Вилучити ${attachment.fileName}`}
                            title="Вилучити"
                            className="task-attachment-action task-attachment-action--remove"
                            disabled={removeAttachment.isPending}
                            onClick={() => removeAttachment.mutate(attachment.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    ))}
                    <TaskFilesArchive attachments={query.data.attachments} />
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
                        <time dateTime={entry.item.createdAt}>{formatDateTime(entry.item.createdAt)}</time>
                        <span>
                          {entry.item.actor?.displayName
                            ? `${personName(entry.item.actor.displayName)} · ${entry.item.label}`
                            : entry.item.label}
                        </span>
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
                      <UserProfileLink
                        className="task-comment__author-avatar"
                        userId={item.author.id}
                        aria-label={`Відкрити профіль ${personName(item.author.displayName)}`}
                      >
                        <Avatar
                          size="sm"
                          name={personName(item.author.displayName)}
                          src={item.author.avatarAsset}
                        />
                      </UserProfileLink>
                      <div className="task-comment__bubble">
                        <div className="task-comment__heading">
                          <UserProfileLink className="task-comment__author" userId={item.author.id}>
                            {personName(item.author.displayName)}
                          </UserProfileLink>
                          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                            {new Date(item.createdAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} {formatChatTime(item.createdAt)}
                          </time>
                        </div>
                        {item.replyPreview && (
                          <blockquote>
                            <strong>{personName(item.replyPreview.authorName)}</strong>
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
                          <FormattedText body={item.body} mentions={item.mentions} hideMentionPrefix />
                        )}
                        {editingComment?.id !== item.id && item.attachments.length > 0 && (
                          <div className="task-comment-attachments">
                            {item.attachments.map((attachment) => (
                              <TaskAttachment key={attachment.id} attachment={attachment} compact />
                            ))}
                            <TaskFilesArchive attachments={item.attachments} />
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
                                      authorName: personName(item.author.displayName),
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
                if (post.isPending || commentFileRemoval.isPending()) return
                const trimmed = trimMentionValue(comment, commentMentions)
                if (trimmed.body || commentAttachmentIds.length > 0) {
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
                      <strong>Відповідь: {personName(replyTo.authorName)}</strong>
                      <small>{replyTo.body.slice(0, 120)}</small>
                    </span>
                    <button type="button" aria-label="Скасувати відповідь" onClick={() => setReplyTo(null)}>
                      <X size={17} />
                    </button>
                  </div>
                )}
                attachments={commentAttachmentIds.length > 0 && (
                  <div className="message-composer__attachments" aria-label="Файли коментаря">
                    {commentAttachments.map((attachment) => {
                      const fileId = attachment.id
                      const fileName = attachment.fileName
                      return (
                        <span key={fileId}>
                          <TaskAttachment attachment={attachment} composer />
                          <button
                            type="button"
                            aria-label={`Прибрати ${fileName} з коментаря`}
                            disabled={post.isPending || commentFileRemoval.pending}
                            onClick={() => void commentFileRemoval.discard(fileId)}
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
                      event.currentTarget.closest('form')?.requestSubmit()
                    }}
                  />
                )}
                sendAction={(
                  <button
                    type="submit"
                    className="message-composer__send"
                    aria-label="Надіслати"
                    disabled={(
                      (!comment.trim() && commentAttachmentIds.length === 0)
                      || post.isPending
                      || uploadAttachment.isPending
                      || attachDriveFile.isPending
                      || commentFileRemoval.pending
                    )}
                  >
                    <Send size={20} />
                  </button>
                )}
              />
              {commentFileRemoval.error && <div className="form-error" role="alert">{commentFileRemoval.error}</div>}
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
                    <DateTimePicker name="remindAt" type="datetime-local" required />
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
                  <DateTimePicker name="firstOccurrenceAt" type="datetime-local" required />
                </label>
                <label>
                  До дати
                  <DateTimePicker name="until" type="datetime-local" />
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
                  До батьківського завдання · № {query.data.parent.number}
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
                        <small>№ {subtask.number}</small>
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
                    <small>Організаційний контекст успадковується автоматично.</small>
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
                  <UserSearchCombobox
                    label="Виконавець"
                    name="assigneeId"
                    defaultUser={query.data.assignee}
                  />
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
                    <DateTimePicker name="deadline" type="datetime-local" />
                  </label>
                  <div className="span-2"><FormattedTextarea label="Опис"
                      name="description"
                      rows={3}
                      maxLength={20000}
                      placeholder="Контекст і критерій готовності"
                    />
                  </div>
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
                    <Button disabled={createSubtask.isPending}>
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
              canChange={editOpen && query.data.canReassign && query.data.status !== 'IN_REVIEW'}
              onChange={(userId) => reassignResponsible.mutate(userId)}
            />
            <TaskParticipantGroup
              label="Співвиконавці"
              emptyLabel="Співвиконавців ще немає"
              participants={query.data.coExecutors}
              role="CO_EXECUTOR"
              canEdit={editOpen && canManageTask && query.data.canManageParticipants}
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

function TaskAttachmentGlyph({ attachment }: { attachment: TaskAttachmentView }) {
  const extension = attachment.fileName.split('.').pop()?.toLowerCase() ?? ''
  const mime = attachment.mimeType.toLowerCase()
  if (officeFileFormat(mime)) return <FileFormatIcon mimeType={mime} size={18} className="task-attachment-glyph" />
  const kind = mime === 'application/pdf' || extension === 'pdf' ? 'pdf'
    : /^(docx?|odt|rtf)$/.test(extension) || /word|opendocument.text|rtf/.test(mime) ? 'word'
    : /^(xlsx?|xlsm|ods|csv)$/.test(extension) || /spreadsheet|excel|csv/.test(mime) ? 'excel'
    : mime.startsWith('image/') || /^(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/.test(extension) ? 'image'
    : /^(zip|rar|7z|tar|gz|bz2|xz)$/.test(extension) || /zip|compressed|archive|tar/.test(mime) ? 'archive'
    : 'other'
  const Icon = kind === 'excel' ? FileSpreadsheet : kind === 'image' ? FileImage : kind === 'archive' ? FileArchive : FileText
  return <span className={`task-attachment-glyph task-attachment-glyph--${kind}`} aria-hidden="true">
    <Icon size={17} />
    {['pdf', 'word', 'excel'].includes(kind) && <span>{kind === 'pdf' ? 'PDF' : kind === 'word' ? 'W' : 'X'}</span>}
  </span>
}

function TaskAttachment({
  attachment,
  compact = false,
  composer = false,
  actions = false,
}: {
  attachment: TaskAttachmentView
  compact?: boolean
  composer?: boolean
  actions?: boolean
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
  const extensionIndex = attachment.fileName.lastIndexOf('.')
  const className = composer
    ? 'task-comment-composer__attachment-name'
    : compact ? 'task-attachment is-compact' : 'task-attachment'
  const content = composer ? (
    <>
      <FileFormatIcon mimeType={attachment.mimeType} size={15} />
      <span>{attachment.fileName}</span>
    </>
  ) : (
    <>
      <TaskAttachmentGlyph attachment={attachment} />
      <span>
        <strong title={attachment.fileName}>
          <span className="task-attachment__stem">{extensionIndex > 0 ? attachment.fileName.slice(0, extensionIndex) : attachment.fileName}</span>
          {extensionIndex > 0 && <span>{attachment.fileName.slice(extensionIndex)}</span>}
        </strong>
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
          className={className}
          aria-label={`Переглянути ${attachment.fileName}`}
          onClick={() => setPreviewOpen(true)}
        >
          {content}
        </button>
        {actions && <>
          <a className="task-attachment-action" href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}
            download={attachment.fileName} title="Завантажити" aria-label={`Завантажити ${attachment.fileName}`}>
            <Download size={15} aria-hidden="true" />
          </a>
          <SaveToDriveButton fileId={attachment.id} fileName={attachment.fileName}
            className="task-attachment-action" iconOnly />
        </>}
        {previewOpen && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
      </>
    )
  }
  return (
    <span className={className}>
      {content}
    </span>
  )
}

function TaskSingleRoleCard({
  label,
  person,
  canChange = false,
  onChange,
}: {
  label: 'Постановник' | 'Відповідальний'
  person: TaskDetailView['reporter']
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
        <Avatar size="sm" name={personName(person.displayName)} src={person.avatarAsset} />
        <strong>{personName(person.displayName)}</strong>
      </UserProfileLink>
      {canChange && onChange && (
          <UserSearchCombobox
            label="Змінити відповідального"
            value=""
            clearOnSelect
            placeholder="Почніть вводити ім’я"
            excludeIds={[person.id]}
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
  excludedUserIds: string[]
  addPending: boolean
  removePending: boolean
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
}) {
  const headingId = `task-role-${role.toLowerCase()}`
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
                  name={personName(participant.user.displayName)}
                  src={participant.user.avatarAsset}
                />
                <strong>{personName(participant.user.displayName)}</strong>
              </UserProfileLink>
              {canEdit && (
                <button
                  type="button"
                  className="task-participant-remove"
                  aria-label={`Вилучити ${personName(participant.user.displayName)} з ролі «${label}»`}
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
          <UserSearchCombobox
            label={`Додати: ${label.toLowerCase()}`}
            value={selectedUserId}
            placeholder="Почніть вводити ім’я"
            excludeIds={excludedUserIds}
            onChange={setSelectedUserId}
          />
          <Button
            type="submit"
            variant="secondary"
            aria-label={`Додати учасника до ролі «${label}»`}
            disabled={addPending || !selectedUserId}
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

function TaskFilesArchive({ attachments }: { attachments: TaskAttachmentView[] }) {
  if (!attachments.length) return null
  const ready = attachments.every((file) => file.scanStatus === 'CLEAN')
  return ready ? (
    <a className="task-files-archive" href={`/api/v1/files/archive?ids=${encodeURIComponent(attachments.map((file) => file.id).join(','))}`}>
      <Download size={14} aria-hidden="true" />
      <span>Завантажити все одним архівом</span>
    </a>
  ) : <span className="task-files-archive muted">Архів буде доступний після перевірки всіх файлів</span>
}
