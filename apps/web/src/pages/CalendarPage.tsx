import { ResizableTextarea } from '../shared/ui/ResizableTextarea'
import { DateTimePicker } from '../shared/ui/DateTimePicker'
import './calendar-event-popover.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  OrganizationCapability,
  type CalendarAudienceOption,
  type CalendarAcknowledgementView,
  type CalendarRecurrenceInput,
  type CalendarEventAudienceInput,
  type EventListItem,
  type TaskDetailView,
} from '@lankadws/contracts'
import { CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Eye, Flag, Pencil, ShieldCheck, Trash2, UserRound, UserRoundPen, UserRoundCheck } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { formatDateTime, statusLabels } from '../shared/lib/format'
import { personName } from '../shared/lib/personName'
import { useTopbarContent } from '../layout/TopbarContent'
import {
  Avatar,
  Button,
  Card,
  ConfirmationDialog,
  DialogBase,
  EmptyState,
  ErrorState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  PageDataLoader,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
  type ModalCloseGuardController,
  type DialogBaseProps,
} from '../shared/ui'

type CalendarEvent = EventListItem & {
  kind?: 'EVENT' | 'TASK'
  taskId?: string
  occurrenceKey?: string
  recurrence?: CalendarRecurrenceInput | null
  reminderMinutes?: number | null
  requiresAcknowledgement?: boolean
  acknowledgement?: CalendarAcknowledgementView | null
  ownerId: string
  ownerName: string
  sourceTimezone: string
  version: number
  audienceCompanyIds: string[]
  audienceLabel: string
}
type CalendarView = 'day' | 'week' | 'month' | 'schedule'
type CalendarScope = 'ALL' | 'MINE' | 'TEAM' | 'TASKS'
type CalendarAnchor = { element: HTMLAnchorElement; rect: DOMRect }

export default function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const { eventId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { user, canUseCapability } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [createDate, setCreateDate] = useState<string | null>(null)
  const [createTitle, setCreateTitle] = useState('')
  const [createDirty, setCreateDirty] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editDirty, setEditDirty] = useState(false)
  const [eventAnchor, setEventAnchor] = useState<CalendarAnchor | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const closeGuard = useModalCloseGuard({
    dirty: (createOpen && createDirty) || (editOpen && editDirty),
    onRequestClose: () => {
      if (createOpen) {
        setCreateDirty(false)
        setCreateOpen(false)
      } else if (editOpen) {
        setEditDirty(false)
        setEditOpen(false)
      } else {
        navigate(`/calendar?${params.toString()}`)
      }
    },
  })
  // Events span every company the principal may write calendar entries for, so
  // the page never depends on a primary company that some accounts do not have.
  const audiences = useQuery({
    queryKey: ['calendar-audiences'],
    queryFn: () => api<{ items: CalendarAudienceOption[]; ownerCompanyId: string | null }>('/calendar/audiences?company=all'),
  })
  const writableCompanies = useMemo(() => audiences.data?.items ?? [], [audiences.data])
  const ownerCompanyId = audiences.data?.ownerCompanyId ?? null
  const rawView = params.get('view')
  const view: CalendarView = rawView === 'day' || rawView === 'week' || rawView === 'schedule' || rawView === 'list'
    ? rawView === 'list' ? 'schedule' : rawView
    : 'month'
  const rawScope = params.get('scope')
  const scope: CalendarScope = rawScope === 'MINE' || rawScope === 'TEAM' || rawScope === 'TASKS' ? rawScope : 'ALL'
  const requestedCreate = params.get('new') === '1'
  const selectedDate = params.get('date') ?? localDateKey(new Date())
  const selectedTaskId = !eventId ? params.get('task') : null
  const dayEventsKey = params.get('dayEvents')
  const dayEventsDate = dayEventsKey && /^\d{4}-\d{2}-\d{2}$/.test(dayEventsKey)
    && Number.isFinite(Date.parse(`${dayEventsKey}T12:00:00`))
    ? new Date(`${dayEventsKey}T12:00:00`) : null
  const date = new Date(`${selectedDate}T12:00:00`)
  const year = date.getFullYear()
  const month = date.getMonth()
  const range = useMemo(() => calendarRange(view, date), [view, selectedDate])
  const query = useQuery({
    queryKey: ['calendar', view, selectedDate, scope],
    queryFn: () => api<{
      items: CalendarEvent[]
      counts: Record<CalendarScope, number>
    }>(
      `/calendar/events?company=all&from=${range.from.toISOString()}&to=${range.to.toISOString()}&scope=${scope}`,
    ),
  })
  const dayEvents = dayEventsDate
    ? (query.data?.items ?? []).filter((event) => eventOverlapsDay(event, dayEventsDate))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.startAt) - Date.parse(b.startAt))
    : []
  const closeDayEvents = () => setParams((current) => {
    current.delete('dayEvents')
    return current
  }, { replace: true })
  const openDayEvents = (day: string) => setParams((current) => {
    current.delete('task')
    current.set('dayEvents', day)
    return current
  })
  const detail = useQuery({
    queryKey: ['calendar-event', eventId],
    queryFn: () => api<CalendarEvent | null>(`/calendar/events/${eventId}?company=all`),
    enabled: Boolean(eventId),
  })
  const taskDetail = useQuery({
    queryKey: ['task', selectedTaskId],
    queryFn: () => api<TaskDetailView | null>(`/tasks/${encodeURIComponent(selectedTaskId!)}`),
    enabled: Boolean(selectedTaskId),
  })
  const closeTask = () => setParams((current) => {
    current.delete('task')
    return current
  }, { replace: true })
  const update = useMutation({
    mutationFn: (input: {
      id: string
      title: string
      description: string
      startAt: string
      endAt: string
      sourceTimezone: string
      allDay: boolean
      requiresAcknowledgement: boolean
      audience: CalendarEventAudienceInput
      recurrence: CalendarRecurrenceInput | null
      expectedVersion: number
      reminderMinutes: number | null
    }) => api<{ id: string; version: number }>(`/calendar/events/${input.id}`, {
      method: 'PATCH',
      body: jsonBody({
        title: input.title,
        description: input.description,
        startAt: input.startAt,
        endAt: input.endAt,
        sourceTimezone: input.sourceTimezone,
        allDay: input.allDay,
        requiresAcknowledgement: input.requiresAcknowledgement,
        audience: input.audience,
        recurrence: input.recurrence,
        reminderMinutes: input.reminderMinutes,
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: async () => {
      closeGuard.closeForSuccess(() => {
        setEditDirty(false)
        setEditOpen(false)
      })
      setParams((current) => {
        current.delete('occurrence')
        return current
      }, { replace: true })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['calendar'] }),
        client.invalidateQueries({ queryKey: ['calendar-event', eventId] }),
      ])
    },
  })
  const acknowledge = useMutation({
    mutationFn: (event: CalendarEvent) => api(`/calendar/events/${event.id}/acknowledge`, {
      method: 'POST', body: jsonBody({ expectedVersion: event.version }),
    }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ['calendar-event'] }),
      client.invalidateQueries({ queryKey: ['feed'] }),
    ]),
  })
  const remove = useMutation({
    mutationFn: (event: CalendarEvent) => api(`/calendar/events/${event.id}`, {
      method: 'DELETE', body: jsonBody({ expectedVersion: event.version }),
    }),
    onSuccess: async (_, event) => {
      setDeleteOpen(false)
      navigate(`/calendar?${params.toString()}`)
      client.removeQueries({ queryKey: ['calendar-event', event.id] })
      await Promise.all(['calendar', 'feed', 'dashboard', 'notifications'].map((key) =>
        client.invalidateQueries({ queryKey: [key] })))
    },
  })
  const days = useMemo(() => {
    const result: Array<{ date: Date; current: boolean }> = []
    const start = new Date(year, month, 1)
    const mondayIndex = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - mondayIndex)
    for (let index = 0; index < 42; index += 1) {
      const current = new Date(start)
      current.setDate(start.getDate() + index)
      result.push({ date: current, current: current.getMonth() === month })
    }
    return result
  }, [year, month])
  const periodDays = useMemo(() => {
    if (view === 'day') return [new Date(date)]
    if (view === 'week') {
      const first = startOfWeek(date)
      return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(first)
        day.setDate(first.getDate() + index)
        return day
      })
    }
    return []
  }, [view, selectedDate])
  const selected = detail.data ?? query.data?.items.find((item) => item.id === eventId)
  const occurrenceStart = params.get('occurrence')
  const shownStart = selected?.recurrence && occurrenceStart && Number.isFinite(Date.parse(occurrenceStart)) ? occurrenceStart : selected?.startAt
  const shownEnd = selected && shownStart ? new Date(Date.parse(shownStart) + Date.parse(selected.endAt) - Date.parse(selected.startAt)).toISOString() : selected?.endAt
  const canCreate = canUseCapability(OrganizationCapability.CalendarWrite)
    && ownerCompanyId !== null
  useEffect(() => {
    if (!requestedCreate || !canCreate) return
    setCreateDate(null)
    setCreateTitle(params.get('title') ?? '')
    setCreateOpen(true)
    setParams((current) => {
      current.delete('new')
      current.delete('title')
      return current
    }, { replace: true })
  }, [canCreate, requestedCreate, setParams])

  const move = useCallback((delta: number) => {
    const next = new Date(`${selectedDate}T12:00:00`)
    if (view === 'day') next.setDate(next.getDate() + delta)
    else if (view === 'week') next.setDate(next.getDate() + (7 * delta))
    else next.setMonth(next.getMonth() + delta, 1)
    setParams((current) => {
      current.set('date', localDateKey(next))
      return current
    })
  }, [selectedDate, setParams, view])

  const moveToToday = useCallback(() => {
    setParams((current) => {
      current.set('date', localDateKey(new Date()))
      return current
    })
  }, [setParams])

  const calendarTitle = useMemo(() => calendarHeading(view, date), [selectedDate, view])
  const calendarAction = useMemo(() => canCreate ? (
    <Button className="calendar-create-action" onClick={() => {
      setCreateDate(null)
      setCreateTitle('')
      setCreateOpen(true)
    }}>
      <CalendarPlus size={17} />
      <span>Створити подію</span>
    </Button>
  ) : null, [canCreate])
  const calendarNavigation = useMemo(() => (
    <div className="calendar-nav calendar-nav--topbar">
      <Button variant="secondary" onClick={moveToToday}>Сьогодні</Button>
      <Button variant="secondary" onClick={() => move(-1)} aria-label="Попередній місяць">
        <ChevronLeft size={17} />
      </Button>
      <strong>{calendarTitle}</strong>
      <Button variant="secondary" onClick={() => move(1)} aria-label="Наступний місяць">
        <ChevronRight size={17} />
      </Button>
    </div>
  ), [calendarTitle, move, moveToToday])
  useTopbarContent(calendarAction)

  return (
    <div onClickCapture={(event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a')
      const href = link?.getAttribute('href')
      const opensPreview = href?.startsWith('/calendar/events/')
        || (href?.startsWith('/calendar?') && new URLSearchParams(href.split('?')[1]).has('task'))
      if (link && opensPreview
        && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        setEventAnchor({ element: link, rect: link.getBoundingClientRect() })
      }
    }}>
      <Card className="calendar-card">
        {query.isLoading ? (
          <PageDataLoader />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <>
            <div className="calendar-view-switch">
              <Tabs
                value={view}
                onChange={(value) => setParams((current) => {
                  current.set('view', value)
                  return current
                })}
                items={[
                  { value: 'day', label: 'День' },
                  { value: 'week', label: 'Тиждень' },
                  { value: 'month', label: 'Місяць' },
                  { value: 'schedule', label: 'Розклад' },
                ]}
              />
              {calendarNavigation}
              <div className="calendar-scope-tabs">
                <Tabs
                  value={scope}
                  onChange={(value) => setParams((current) => {
                    if (value === 'ALL') current.delete('scope')
                    else current.set('scope', value)
                    return current
                  })}
                  items={[
                    { value: 'ALL', label: 'Усі', count: query.data?.counts.ALL },
                    { value: 'MINE', label: 'Особисті', count: query.data?.counts.MINE },
                    { value: 'TEAM', label: 'Компанія', count: query.data?.counts.TEAM },
                    { value: 'TASKS', label: 'Завдання', count: query.data?.counts.TASKS },
                  ]}
                />
              </div>
            </div>
            {view === 'schedule' ? (
              query.data?.items.length ? (
                <div className="calendar-agenda">
                  {query.data.items.map((event) => (
                    <Link className={calendarItemClass(event)} to={calendarItemLink(event, params.toString())} key={event.occurrenceKey ?? event.id}>
                      <time dateTime={event.startAt}>
                        <strong>{new Intl.DateTimeFormat('uk-UA', { day: '2-digit' }).format(new Date(event.startAt))}</strong>
                        <span>{new Intl.DateTimeFormat('uk-UA', { month: 'short' }).format(new Date(event.startAt))}</span>
                      </time>
                      <span>
                        <strong>{event.title}</strong>
                        <small>
                          {event.allDay
                            ? 'Увесь день'
                            : `${formatDateTime(event.startAt)} — ${new Intl.DateTimeFormat('uk-UA', {
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(new Date(event.endAt))}`}
                          {event.ownerId !== user?.id && ` · ${event.ownerName}`}
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="У цьому місяці подій немає"
                  description="Створіть подію або перейдіть до іншого місяця."
                  illustration="calendar"
                />
              )
            ) : view === 'day' || view === 'week' ? (
              <CalendarPeriodView
                days={periodDays}
                events={query.data?.items ?? []}
                currentUserId={user?.id ?? ''}
                queryString={params.toString()}
                canCreate={canCreate}
                onCreate={(day) => {
                  setCreateDate(localDateKey(day))
                  setCreateTitle('')
                  setCreateOpen(true)
                }}
              />
            ) : (
              <>
                <div className="calendar-weekdays">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((item) => <span key={item}>{item}</span>)}
                </div>
                <div className="calendar-grid">
                  {days.map(({ date: day, current }) => {
                    const iso = localDateKey(day)
                    const events = query.data?.items.filter(
                      (item) => eventOverlapsDay(item, day),
                    ) ?? []
                    return (
                      <div
                        className={`${current ? '' : 'is-outside'} ${iso === localDateKey(new Date()) ? 'is-today' : ''}`}
                        key={iso}
                      >
                          <button
                            type="button"
                            className="calendar-day-action"
                            aria-label={`Переглянути події на ${new Intl.DateTimeFormat('uk-UA', {
                              day: 'numeric',
                              month: 'long',
                            }).format(day)}`}
                            onClick={() => openDayEvents(iso)}
                          >
                            {day.getDate()}
                          </button>
                        {events.slice(0, 3).map((event) => (
                          <Link className={calendarItemClass(event)} title={event.title} to={calendarItemLink(event, params.toString())} key={event.occurrenceKey ?? event.id}>
                            {event.title}
                          </Link>
                        ))}
                        {events.length > 3 && (
                          <button type="button" className="calendar-more-events"
                            aria-label={`Переглянути всі події на ${new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(day)}`}
                            onClick={() => openDayEvents(iso)}>
                            +{events.length - 3} ще
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Card>
      {dayEventsDate && !eventId && !selectedTaskId && (
        <Modal
          title={new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }).format(dayEventsDate)}
          description="Усі події та завдання за день"
          size="lg"
          onRequestClose={closeDayEvents}
          footer={canCreate && (
            <Button onClick={() => {
              setCreateDate(dayEventsKey)
              setCreateTitle('')
              closeDayEvents()
              setCreateOpen(true)
            }}>
              <CalendarPlus size={17} /> Створити подію
            </Button>
          )}
        >
          {query.isLoading ? <PageDataLoader /> : dayEvents.length ? (
            <ul className="calendar-card calendar-day-events">
              {dayEvents.map((event) => (
                <li key={event.occurrenceKey ?? event.id}>
                  <Link className={calendarItemClass(event)}
                    to={calendarItemLink(event, new URLSearchParams([...params].filter(([key]) => key !== 'dayEvents')).toString())}
                    onClick={closeDayEvents}>
                    <span className="calendar-day-events__meta">
                      {event.kind === 'TASK' ? 'Завдання' : event.visibility === 'PRIVATE' ? 'Особиста подія' : 'Робоча подія'}
                      {' · '}{event.allDay ? 'Увесь день' : new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.startAt))}
                    </span>
                    <strong>{event.title}</strong>
                    {event.description && <p>{event.description}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="На цей день подій немає" description="Заплановані події та завдання з’являться тут." illustration="calendar" />}
        </Modal>
      )}
      {selectedTaskId && (
        <CalendarEventDialog
          key={selectedTaskId}
          anchor={eventAnchor}
          editing={false}
          category="calendar-item-task"
          title={taskDetail.isError ? 'Завдання недоступне' : taskDetail.data?.title ?? query.data?.items.find((item) => item.kind === 'TASK' && (item.taskId ?? item.id) === selectedTaskId)?.title ?? 'Завдання'}
          description={taskDetail.data && !taskDetail.isError ? `Завдання ${taskDetail.data.number}` : undefined}
          onRequestClose={closeTask}
          footer={taskDetail.data && !taskDetail.isError ? (
            <Link className="button button--primary" to={`/tasks/${encodeURIComponent(selectedTaskId)}`}>
              Перейти до завдання <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : undefined}
        >
          {taskDetail.isLoading ? <div className="calendar-popover-loading" role="status">Завантаження завдання…</div> : taskDetail.isError ? (
            <ErrorState onRetry={() => void taskDetail.refetch()} />
          ) : taskDetail.data ? (
            <dl className="calendar-task-summary">
              <div>
                <dt><UserRoundPen size={15} aria-hidden="true" /> Постановник</dt>
                <dd>
                  <UserProfileLink className="calendar-task-summary__person" userId={taskDetail.data.reporter.id}>
                    <Avatar size="sm" name={taskDetail.data.reporter.displayName} src={taskDetail.data.reporter.avatarAsset} />
                    <span>{personName(taskDetail.data.reporter.displayName)}</span>
                  </UserProfileLink>
                </dd>
              </div>
              <div>
                <dt><UserRoundCheck size={15} aria-hidden="true" /> Відповідальний</dt>
                <dd>
                  <UserProfileLink className="calendar-task-summary__person" userId={taskDetail.data.assignee.id}>
                    <Avatar size="sm" name={taskDetail.data.assignee.displayName} src={taskDetail.data.assignee.avatarAsset} />
                    <span>{personName(taskDetail.data.assignee.displayName)}</span>
                  </UserProfileLink>
                </dd>
              </div>
              <div><dt><CalendarDays size={15} aria-hidden="true" /> Дата постановки</dt><dd>{formatDateTime(taskDetail.data.createdAt)}</dd></div>
              <div><dt><CalendarDays size={15} aria-hidden="true" /> Термін виконання</dt><dd>{taskDetail.data.deadline ? formatDateTime(taskDetail.data.deadline) : 'Без терміну'}</dd></div>
              <div><dt><CircleCheck size={15} aria-hidden="true" /> Статус</dt><dd>{statusLabels[taskDetail.data.status] ?? taskDetail.data.status}</dd></div>
              <div><dt><Flag size={15} aria-hidden="true" /> Пріоритет</dt><dd>{{ LOW: 'Низький', MEDIUM: 'Звичайний', HIGH: 'Високий', CRITICAL: 'Критичний' }[taskDetail.data.priority]}</dd></div>
            </dl>
          ) : <EmptyState title="Завдання недоступне" description="Можливо, його видалено або у вас немає доступу." />}
        </CalendarEventDialog>
      )}
      {eventId && (
        <CalendarEventDialog
          anchor={eventAnchor}
          editing={editOpen}
          category={selected ? calendarItemClass(selected) : undefined}
          title={editOpen ? 'Редагувати подію' : selected?.title ?? 'Подія'}
          description={!editOpen && selected ? selected.visibility === 'PRIVATE' ? 'Особиста подія' : 'Подія компанії' : undefined}
          onBeforeClose={closeGuard.shouldClose}
          onRequestClose={closeGuard.requestClose}
          header={!editOpen && selected ? (
            <>
            <p className="calendar-event-detail__time">
              <CalendarDays size={16} aria-hidden="true" />
              <span>
                {selected.allDay
                  ? `${new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(shownStart!))} · Увесь день`
                  : `${formatDateTime(shownStart!)} — ${formatDateTime(shownEnd!)}`}
              </span>
            </p>
            {selected.recurrence && <p className="calendar-event-owner">Повторення: {selected.recurrence.frequency === 'DAILY' ? 'щодня' : selected.recurrence.frequency === 'WEEKLY' ? 'щотижня' : 'щомісяця'} · інтервал {selected.recurrence.interval}{selected.recurrence.until ? ` · до ${formatDateTime(selected.recurrence.until)}` : ''}</p>}
            </>
          ) : undefined}
          footer={selected && !editOpen && selected.ownerId === user?.id && canCreate ? (
            <div className="calendar-event-actions">
            <Button variant="danger" disabled={detail.isLoading || !detail.data} onClick={() => {
              remove.reset()
              setDeleteOpen(true)
            }}><Trash2 size={16} /> Видалити</Button>
            <Button variant="secondary" disabled={detail.isLoading || !detail.data} onClick={() => {
              setEditDirty(false)
              setEditOpen(true)
            }}>
              <Pencil size={16} />
              Редагувати
            </Button>
            </div>
          ) : undefined}
        >
          {selected ? (
            editOpen ? (
              <CalendarEventForm
                event={selected}
                companies={writableCompanies}
                onDirtyChange={setEditDirty}
                onSubmit={(values) => {
                  update.mutate({
                    id: selected.id,
                    title: values.title,
                    description: values.description,
                    startAt: values.startAt,
                    endAt: values.endAt,
                    sourceTimezone: values.sourceTimezone,
                    allDay: values.allDay,
                    requiresAcknowledgement: values.requiresAcknowledgement,
                    audience: values.audience,
                    recurrence: values.recurrence,
                    reminderMinutes: values.reminderMinutes,
                    expectedVersion: selected.version,
                  })
                }}
              >
                {update.isError && (
                  <div className="form-error span-2" role="alert">
                    Не вдалося зберегти зміни. Можливо, подію вже оновили.
                  </div>
                )}
                <div className="form-actions span-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => closeGuard.requestClose('cancel-button')}
                  >
                    Скасувати
                  </Button>
                  <Button disabled={update.isPending}>
                    {update.isPending ? 'Зберігаємо…' : 'Зберегти'}
                  </Button>
                </div>
              </CalendarEventForm>
            ) : (
              <div className="detail-stack calendar-event-detail">
                {selected.description && (
                  <div className="calendar-event-description">
                    {selected.description.split('\n').map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                )}
                <div className="calendar-event-detail__people">
                  <p className="calendar-event-detail__person">
                    <UserRound size={16} aria-hidden="true" />
                    <span>Організатор: <strong>{selected.ownerId === user?.id ? 'Ви' : selected.ownerName}</strong></span>
                  </p>
                  <p className="calendar-event-detail__person">
                    <Eye size={16} aria-hidden="true" />
                    <span>Бачать: <strong>{selected.visibility === 'PRIVATE' ? 'тільки я' : selected.audienceLabel}</strong></span>
                  </p>
                </div>
                {selected.requiresAcknowledgement && selected.acknowledgement && (selected.acknowledgement.requiredForMe || selected.acknowledgement.acknowledgedAt) && (
                  <div className={`feed-acknowledgement calendar-event-detail__acknowledgement${selected.acknowledgement.acknowledgedAt ? ' is-done' : ''}`}>
                    <ShieldCheck size={20} aria-hidden="true" />
                    <span>
                      <strong>{selected.acknowledgement.acknowledgedAt ? 'Ви підтвердили ознайомлення' : 'Ознайомлення з подією'}</strong>
                    </span>
                    {selected.acknowledgement.requiredForMe && !selected.acknowledgement.acknowledgedAt && (
                      <Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(selected)}>
                        {acknowledge.isPending ? 'Підтверджуємо…' : 'Ознайомився'}
                      </Button>
                    )}
                  </div>
                )}
                {acknowledge.isError && <p className="form-error" role="alert">Не вдалося підтвердити ознайомлення. Оновіть подію та спробуйте ще раз.</p>}
              </div>
            )
          ) : detail.isLoading ? (
            <div className="calendar-popover-loading" role="status">Завантаження події…</div>
          ) : (
            <EmptyState
              title="Подія недоступна"
              description="Можливо, її видалено або у вас немає доступу."
            />
          )}
        </CalendarEventDialog>
      )}
      {deleteOpen && selected && (
        <ConfirmationDialog
          title={selected.recurrence ? 'Видалити всю серію подій?' : 'Видалити подію?'}
          description={selected.recurrence
            ? `«${selected.title}»: буде видалено всі повторення цієї події. Цю дію неможливо скасувати.`
            : `«${selected.title}» буде видалено з календаря. Цю дію неможливо скасувати.`}
          confirmLabel={remove.isPending ? 'Видаляємо…' : 'Видалити'}
          confirmDisabled={remove.isPending}
          onRequestClose={() => { if (!remove.isPending) setDeleteOpen(false) }}
          onConfirm={() => remove.mutate(selected)}
        >
          {remove.isError && <p className="form-error" role="alert">Не вдалося видалити подію. Оновіть календар і спробуйте ще раз.</p>}
        </ConfirmationDialog>
      )}
      {createOpen && (
        <CalendarCreateModal
          companies={writableCompanies}
          ownerCompanyId={ownerCompanyId}
          initialDate={createDate}
          initialTitle={createTitle}
          closeGuard={closeGuard}
          onDirtyChange={setCreateDirty}
          onCreated={(id) => {
            setCreateDirty(false)
            setCreateOpen(false)
            void client.invalidateQueries({ queryKey: ['calendar'] })
            void client.invalidateQueries({ queryKey: ['feed'] })
            const next = new URLSearchParams(params)
            navigate(`/calendar/events/${id}?${next.toString()}`)
          }}
        />
      )}
      <UnsavedChangesDialog
        guard={closeGuard}
        title={createOpen ? 'Закрити створення події?' : 'Закрити редагування події?'}
        description={createOpen
          ? 'Нова подія не буде створена.'
          : 'Незбережені зміни події буде втрачено.'}
      />
    </div>
  )
}

function CalendarEventDialog({ anchor, editing, category = '', ...props }: Omit<DialogBaseProps, 'variant'> & {
  anchor: CalendarAnchor | null
  editing: boolean
  category?: string
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const propsRef = useRef(props)
  propsRef.current = props
  const requestClose = useCallback((reason: 'escape' | 'backdrop' | 'close-button') => {
    if (propsRef.current.onBeforeClose?.(reason) === false) return
    propsRef.current.onRequestClose(reason)
  }, [])
  useLayoutEffect(() => {
    const panel = dialogRef.current
    if (!panel || editing) return
    const position = () => {
      const width = panel.offsetWidth
      const height = panel.offsetHeight
      if (window.innerWidth < 768 || !anchor) {
        panel.style.left = `${Math.max(16, (document.documentElement.clientWidth - width) / 2)}px`
        panel.style.top = `${Math.max(16, (window.innerHeight - height) / 2)}px`
        return
      }
      const rect = anchor.element.isConnected ? anchor.element.getBoundingClientRect() : anchor.rect
      const right = rect.right + 12
      const left = right + width <= window.innerWidth - 16 ? right : rect.left - width - 12
      panel.style.left = `${Math.max(16, Math.min(left, window.innerWidth - width - 16))}px`
      panel.style.top = `${Math.max(16, Math.min(rect.top, window.innerHeight - height - 16))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      panel.style.removeProperty('left')
      panel.style.removeProperty('top')
    }
  }, [anchor, editing])
  useLayoutEffect(() => {
    const panel = dialogRef.current
    if (editing || !panel) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => {
      if (panel.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [editing])
  useEffect(() => {
    if (editing) return
    const modalOpen = () => Boolean(document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])'))
    const outside = (event: PointerEvent) => {
      if (modalOpen() || dialogRef.current?.contains(event.target as Node)) return
      requestClose('backdrop')
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || modalOpen()) return
      event.preventDefault()
      requestClose('escape')
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [editing, requestClose])
  if (editing) return <DialogBase {...props} variant="modal" size="lg"
    dialogRef={dialogRef} mobileFullscreen className="calendar-event-editor" />
  return createPortal(
    <ModalPanel ref={dialogRef} variant="modal" size="sm" role="dialog" tabIndex={-1}
      aria-labelledby={titleId} aria-describedby={props.description ? descriptionId : undefined}
      className={`calendar-event-popover ${category}${anchor ? ' is-anchored' : ''}`}>
      <ModalHeader title={props.title} description={props.description} titleId={titleId}
        descriptionId={descriptionId} onRequestClose={() => requestClose('close-button')}>
        <div>
          <h2 id={titleId}>{props.title}</h2>
          {props.description && <p id={descriptionId}>{props.description}</p>}
          {props.header}
        </div>
      </ModalHeader>
      <ModalBody variant="modal">{props.children}</ModalBody>
      {props.footer && <ModalFooter variant="modal">{props.footer}</ModalFooter>}
    </ModalPanel>, document.body,
  )
}

function CalendarPeriodView({
  days,
  events,
  currentUserId,
  queryString,
  canCreate,
  onCreate,
}: {
  days: Date[]
  events: CalendarEvent[]
  currentUserId: string
  queryString: string
  canCreate: boolean
  onCreate: (day: Date) => void
}) {
  return (
    <div className={`calendar-period ${days.length === 1 ? 'is-day' : 'is-week'}`}>
      {days.map((day) => {
        const dayEvents = events.filter((event) => eventOverlapsDay(event, day))
        const today = localDateKey(day) === localDateKey(new Date())
        return (
          <section className={today ? 'is-today' : ''} key={localDateKey(day)}>
            <header>
              <span>{new Intl.DateTimeFormat('uk-UA', { weekday: 'short' }).format(day)}</span>
              <strong>{day.getDate()}</strong>
              {canCreate && (
                <button type="button" onClick={() => onCreate(day)} aria-label="Створити подію цього дня">
                  <CalendarPlus size={15} />
                </button>
              )}
            </header>
            <div>
              {dayEvents.length ? dayEvents.map((event) => (
                <Link
                  className={calendarItemClass(event)}
                  to={calendarItemLink(event, queryString)}
                  key={event.occurrenceKey ?? event.id}
                >
                  <time>
                    {event.allDay
                      ? 'Увесь день'
                      : new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.startAt))}
                  </time>
                  <strong>{event.title}</strong>
                  {event.kind !== 'TASK' && event.ownerId !== currentUserId && <small>{event.ownerName}</small>}
                </Link>
              )) : <p>Вільно</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CalendarCreateModal({
  companies,
  ownerCompanyId,
  initialDate,
  initialTitle,
  closeGuard,
  onDirtyChange,
  onCreated,
}: {
  companies: CalendarAudienceOption[]
  ownerCompanyId: string | null
  initialDate: string | null
  initialTitle: string
  closeGuard: ModalCloseGuardController
  onDirtyChange: (dirty: boolean) => void
  onCreated: (id: string) => void
}) {
  const attempt = useRef({ signature: '', key: '' })
  const create = useMutation({
    mutationFn: (input: CalendarEventFormValues & { companyId: string; key: string }) =>
      api<{ id: string }>('/calendar/events', {
        method: 'POST',
        headers: { 'idempotency-key': input.key },
        body: jsonBody({
          companyId: input.companyId,
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          endAt: input.endAt,
          sourceTimezone: input.sourceTimezone,
          allDay: input.allDay,
          requiresAcknowledgement: input.requiresAcknowledgement,
          audience: input.audience,
          recurrence: input.recurrence,
          reminderMinutes: input.reminderMinutes,
        }),
      }),
    onSuccess: (result) => closeGuard.closeForSuccess(() => onCreated(result.id)),
  })

  function submit(values: CalendarEventFormValues) {
    if (!ownerCompanyId) return
    const input = { ...values, companyId: ownerCompanyId }
    const signature = JSON.stringify(input)
    if (attempt.current.signature !== signature) {
      attempt.current = { signature, key: idempotencyKey('calendar-event') }
    }
    create.mutate({ ...input, key: attempt.current.key })
  }

  return (
    <Modal
      title="Нова подія"
      size="xl"
      onBeforeClose={closeGuard.shouldClose}
      onRequestClose={closeGuard.requestClose}
    >
      <CalendarEventForm
        companies={companies}
        initialDate={initialDate}
        initialTitle={initialTitle}
        onDirtyChange={onDirtyChange}
        onSubmit={submit}
      >
        {create.isError && (
          <div className="form-error span-2" role="alert">
            Не вдалося створити подію. Перевірте час початку й завершення, час нагадування та кому вона буде видна. Час нагадування має бути в майбутньому.
          </div>
        )}
        <div className="form-actions span-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => closeGuard.requestClose('cancel-button')}
          >
            Скасувати
          </Button>
          <Button disabled={create.isPending}>
            <CalendarPlus size={17} />
            {create.isPending ? 'Створюємо…' : 'Створити подію'}
          </Button>
        </div>
      </CalendarEventForm>
    </Modal>
  )
}

interface CalendarEventFormValues {
  requiresAcknowledgement: boolean
  reminderMinutes: number | null
  title: string
  description: string
  startAt: string
  endAt: string
  sourceTimezone: string
  allDay: boolean
  audience: CalendarEventAudienceInput
  recurrence: CalendarRecurrenceInput | null
}

/**
 * Shared field set for creating and editing an event. Company selection decides
 * who sees the event; "Тільки я" keeps it out of every shared calendar.
 */
function CalendarEventForm({
  event,
  companies,
  initialDate,
  initialTitle,
  onDirtyChange,
  onSubmit,
  children,
}: {
  event?: CalendarEvent
  companies: CalendarAudienceOption[]
  initialDate?: string | null
  initialTitle?: string
  onDirtyChange: (dirty: boolean) => void
  onSubmit: (values: CalendarEventFormValues) => void
  children: ReactNode
}) {
  const defaults = useRef(nextEventWindow(initialDate ?? null))
  const [privateOnly, setPrivateOnly] = useState(event ? event.visibility === 'PRIVATE' : true)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>(
    event && event.visibility !== 'PRIVATE' ? event.audienceCompanyIds : [],
  )
  const [frequency, setFrequency] = useState<CalendarRecurrenceInput['frequency'] | ''>(event?.recurrence?.frequency ?? '')
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState<string>(event?.reminderMinutes == null ? '' : String(event.reminderMinutes))
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(event?.requiresAcknowledgement ?? false)
  const everyCompanyId = companies.map((company) => company.companyId)
  const audienceCompanyIds = selectedCompanyIds.filter((companyId) => everyCompanyId.includes(companyId))
  const audienceSummary = privateOnly
    ? 'Тільки я'
    : audienceCompanyIds.length > 0
      ? companies.filter((company) => audienceCompanyIds.includes(company.companyId)).map((company) => company.label).join(', ')
      : 'Не обрано'

  function toggleCompany(companyId: string, checked: boolean) {
    setPrivateOnly(false)
    setReminderMinutes('')
    setSelectedCompanyIds(checked
      ? [...audienceCompanyIds, companyId]
      : audienceCompanyIds.filter((item) => item !== companyId))
  }

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    const form = new FormData(formEvent.currentTarget)
    if (!privateOnly && audienceCompanyIds.length === 0) return
    onSubmit({
      reminderMinutes: privateOnly && reminderMinutes !== '' ? Number(reminderMinutes) : null,
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      startAt: new Date(String(form.get('startAt'))).toISOString(),
      endAt: new Date(String(form.get('endAt'))).toISOString(),
      sourceTimezone: event?.sourceTimezone
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'Europe/Kyiv',
      allDay: form.get('allDay') === 'on',
      requiresAcknowledgement: !privateOnly && requiresAcknowledgement,
      recurrence: frequency ? {
        frequency, interval: Number(form.get('repeatInterval') ?? 1),
        until: form.get('repeatUntil') ? new Date(`${String(form.get('repeatUntil'))}T23:59:59`).toISOString() : null,
      } : null,
      audience: privateOnly
        ? { type: 'PRIVATE' }
        : { type: 'COMPANIES', companyIds: audienceCompanyIds },
    })
  }

  return (
    <form
      className="entity-form calendar-create"
      onChange={() => onDirtyChange(true)}
      onSubmit={submit}
    >
      <label className="span-2">
        Назва
        <input
          name="title"
          required
          minLength={2}
          maxLength={180}
          autoFocus
          defaultValue={event?.title ?? initialTitle ?? ''}
          placeholder="Наприклад, зустріч команди"
        />
      </label>
      <label className="span-2">
        Опис
        <ResizableTextarea
          name="description"
          rows={4}
          maxLength={4_000}
          defaultValue={event?.description ?? ''}
          placeholder="Порядок денний, посилання на зустріч або нотатки"
        />
      </label>
      <div className="calendar-event-timing span-2">
        <label>
          Початок
          <DateTimePicker
            type="datetime-local"
            name="startAt"
            required
            defaultValue={event ? localDateTime(new Date(event.startAt)) : defaults.current.start}
          />
        </label>
        <label>
          Завершення
          <DateTimePicker
            type="datetime-local"
            name="endAt"
            required
            defaultValue={event ? localDateTime(new Date(event.endAt)) : defaults.current.end}
          />
        </label>
        <label>
          Повторення
          <select value={frequency} onChange={(changed) => setFrequency(changed.target.value as typeof frequency)}>
            <option value="">Не повторюється</option>
            <option value="DAILY">Щодня</option>
            <option value="WEEKLY">Щотижня</option>
            <option value="MONTHLY">Щомісяця</option>
          </select>
        </label>
        <label>
          Нагадування для себе
          <select aria-label="Нагадування для себе" disabled={!privateOnly} value={privateOnly ? reminderMinutes : ''}
            onChange={(changed) => setReminderMinutes(changed.target.value)}>
            <option value="">Не нагадувати</option>
            <option value="0">У момент початку</option>
            <option value="5">За 5 хвилин</option>
            <option value="10">За 10 хвилин</option>
            <option value="15">За 15 хвилин</option>
            <option value="30">За 30 хвилин</option>
            <option value="60">За 1 годину</option>
            <option value="120">За 2 години</option>
            <option value="1440">За 1 день</option>
          </select>
        </label>
      </div>
      <div className="calendar-event-options span-2">
        <label className="feed-ack-option calendar-event-option">
          <input type="checkbox" name="allDay" defaultChecked={event?.allDay ?? false} />
          <span>
            <strong>Подія на весь день</strong>
            <small>Без прив’язки до часу доби</small>
          </span>
        </label>
        <label className="feed-ack-option calendar-event-option" title={privateOnly ? 'Оберіть адресатів у полі «Бачать»' : undefined}>
          <input type="checkbox" checked={!privateOnly && requiresAcknowledgement} disabled={privateOnly}
            onChange={(changed) => setRequiresAcknowledgement(changed.target.checked)} />
          <span>
            <strong>Пункт «Ознайомився»</strong>
            <small>{privateOnly ? 'Оберіть адресатів у полі «Бачать»' : 'Адресати підтверджують окремо'}</small>
          </span>
        </label>
      </div>
      {frequency && <>
        <label>Кожні (днів / тижнів / місяців)
          <input type="number" name="repeatInterval" min={1} max={365} required defaultValue={event?.recurrence?.interval ?? 1} />
        </label>
        <label>Повторювати до (необов’язково)
          <DateTimePicker type="date" name="repeatUntil" defaultValue={event?.recurrence?.until ? localDateKey(new Date(event.recurrence.until)) : ''} />
        </label>
      </>}
      {event?.recurrence && <p className="privacy-note span-2">Зміни застосовуються до всієї серії подій.</p>}
      {event && !privateOnly && requiresAcknowledgement && (
        <p className="privacy-note span-2">Після збереження змін адресатам потрібно буде підтвердити ознайомлення знову.</p>
      )}
      <div className={`calendar-audience-select span-2${audienceOpen ? ' is-open' : ''}`}>
        <button
          className="calendar-audience-select__trigger"
          type="button"
          aria-expanded={audienceOpen}
          onClick={() => setAudienceOpen((current) => !current)}
        >
          <ChevronDown size={16} />
          <span>Бачать: <strong>{audienceSummary}</strong></span>
        </button>
        {audienceOpen && (
          <fieldset className="calendar-company-audience">
            <legend className="sr-only">Хто побачить подію</legend>
            <label title="Тільки я">
              <span>Тільки я</span>
              <input
                type="checkbox"
                checked={privateOnly}
                onChange={(changed) => {
                  setPrivateOnly(changed.target.checked)
                  if (changed.target.checked) setSelectedCompanyIds([])
                }}
              />
            </label>
            {companies.map((company) => (
              <label key={company.companyId} title={company.label}>
                <span>{company.label}</span>
                <input
                  type="checkbox"
                  checked={!privateOnly && audienceCompanyIds.includes(company.companyId)}
                  onChange={(changed) => toggleCompany(company.companyId, changed.target.checked)}
                />
              </label>
            ))}
            {companies.length === 0 && <span className="calendar-company-audience__empty">Немає компаній із увімкненим календарем.</span>}
          </fieldset>
        )}
        {!privateOnly && audienceCompanyIds.length === 0 && (
          <p className="calendar-audience__hint" role="alert">
            Оберіть щонайменше одну компанію або позначте «Тільки я».
          </p>
        )}
      </div>
      {children}
    </form>
  )
}

function nextEventWindow(initialDate?: string | null): { start: string; end: string } {
  const now = new Date()
  const start = initialDate && initialDate !== localDateKey(now)
    ? new Date(`${initialDate}T09:00:00`)
    : new Date(now)
  if (!initialDate || initialDate === localDateKey(now)) {
    start.setHours(start.getHours() + 1, 0, 0, 0)
  }
  return {
    start: localDateTime(start),
    end: localDateTime(new Date(start.getTime() + 60 * 60 * 1000)),
  }
}

function startOfWeek(value: Date): Date {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

function calendarRange(view: CalendarView, value: Date): { from: Date; to: Date } {
  if (view === 'day') {
    const from = new Date(value)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return { from, to }
  }
  if (view === 'week') {
    const from = startOfWeek(value)
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    return { from, to }
  }
  if (view === 'month') {
    const from = startOfWeek(new Date(value.getFullYear(), value.getMonth(), 1))
    const to = new Date(from)
    to.setDate(to.getDate() + 42)
    return { from, to }
  }
  return {
    from: new Date(value.getFullYear(), value.getMonth(), 1),
    to: new Date(value.getFullYear(), value.getMonth() + 1, 1),
  }
}

function calendarHeading(view: CalendarView, value: Date): string {
  if (view === 'day') {
    return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }).format(value)
  }
  if (view === 'week') {
    const first = startOfWeek(value)
    const last = new Date(first)
    last.setDate(last.getDate() + 6)
    return `${new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(first)} — ${new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' }).format(last)}`
  }
  return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(value)
}

function eventOverlapsDay(event: CalendarEvent, day: Date): boolean {
  const from = new Date(day)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return new Date(event.startAt) < to && (event.kind === 'TASK' ? new Date(event.startAt) >= from : new Date(event.endAt) > from)
}

function localDateKey(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
}

function localDateTime(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`
}

function calendarItemClass(event: CalendarEvent): string {
  return event.kind === 'TASK' ? 'calendar-item-task'
    : event.visibility === 'PRIVATE' ? 'calendar-item-private' : 'calendar-item-work'
}

function calendarItemLink(event: CalendarEvent, queryString: string): string {
  const search = new URLSearchParams(queryString)
  search.delete('occurrence')
  search.delete('task')
  search.delete('dayEvents')
  if (event.kind === 'TASK') {
    search.set('task', event.taskId ?? event.id)
    return `/calendar?${search.toString()}`
  }
  if (event.recurrence) search.set('occurrence', event.startAt)
  return `/calendar/events/${event.id}?${search.toString()}`
}
