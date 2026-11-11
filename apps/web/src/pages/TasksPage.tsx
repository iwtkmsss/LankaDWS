import { DateTimePicker } from '../shared/ui/DateTimePicker'
import { personName } from '../shared/lib/personName'
import { TaskUnreadBadge, useUnreadTaskCounts } from '../features/notifications/TaskUnreadBadge'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import type {
  PageResult,
  TaskListItem,
  TaskViewRole,
} from '@lankadws/contracts'
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  ArrowDown,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  CirclePlus,
  Flag,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate } from '../shared/lib/format'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { TaskListColumnsControl, useTaskListColumnsPreference } from '../features/tasks/list/TaskListColumns'
import { TaskStatusPicker } from '../features/tasks/list/TaskStatusPicker'
import { TaskStatusFilters } from '../features/tasks/list/TaskStatusFilters'
import { readTaskStatusFilter, writeTaskStatusFilter } from '../features/tasks/list/task-status-filters'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageDataLoader,
  PageHeader,
  StatusBadge,
} from '../shared/ui'
import { TaskDetailPage } from '../features/tasks/detail/TaskDetailSurface'
import { taskPriorityLabel } from '../features/tasks/detail/taskLabels'

export default function TasksPage() {
  const { taskId } = useParams()
  return taskId ? <TaskDetailPage id={taskId} /> : <TasksListPage />
}

function TasksListPage() {
  const unreadTaskCounts = useUnreadTaskCounts()
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
  const archiveActive = statusFilter.selected.length === 1 && statusFilter.selected[0] === 'ARCHIVED'
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
    { value: 'RESPONSIBLE', label: 'Відповідальний' },
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
          <button type="button" className={`task-archive-filter${archiveActive ? ' is-active' : ''}`}
            aria-label="Архівовані завдання" title="Архівовані завдання" aria-pressed={archiveActive}
            onClick={() => updateParams((current) => {
              const active = archiveActive
              for (const key of Array.from(current.keys())) current.delete(key)
              if (!active) {
                current.set('role', 'ALL')
                writeTaskStatusFilter(current, 'ALL', ['ARCHIVED'])
              }
            })}><Archive size={19} aria-hidden="true" /></button>
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
                  {taskListColumns.visible.includes('responsibles') && renderSortHeader('responsibles', 'Відповідальні')}
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
                        <span>
                          <strong>{task.title}<TaskUnreadBadge count={unreadTaskCounts.get(task.id) ?? 0} /></strong>
                          <small>
                            {task.number}
                            {task.parentTaskId ? ' · Підзадача' : ''}
                          </small>
                        </span>
                      </Link>
                    </td>
                    {taskListColumns.visible.includes('reporter') && <td data-label="Постановник"><UserProfileLink className="person-cell" userId={task.reporter.id}><Avatar size="sm" name={personName(task.reporter.displayName)} src={task.reporter.avatarAsset} />{personName(task.reporter.displayName)}</UserProfileLink></td>}
                    {taskListColumns.visible.includes('responsibles') && <td data-label="Відповідальні">
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
                        <span className={`task-deadline ${isTaskOverdue(task) ? 'is-overdue' : isTaskDueSoon(task) ? 'is-due-soon' : ''}`}>
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


function isTaskOverdue(task: TaskListItem): boolean {
  return Boolean(
    task.deadline
    && new Date(task.deadline).getTime() < Date.now()
    && !['DONE', 'ARCHIVED'].includes(task.status),
  )
}

function isTaskDueSoon(task: TaskListItem): boolean {
  if (!task.deadline || ['DONE', 'ARCHIVED'].includes(task.status)) return false
  const remaining = new Date(task.deadline).getTime() - Date.now()
  return remaining >= 0 && remaining <= 72 * 60 * 60 * 1000
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
      description: 'Створені вами завдання залишатимуться тут незалежно від відповідального.',
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

