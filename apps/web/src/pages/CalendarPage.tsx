import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OrganizationCapability, type EventListItem } from '@bert-crm/contracts'
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
  type ModalCloseGuardController,
} from '../shared/ui'

type CalendarEvent = EventListItem & {
  ownerId: string
  ownerName: string
  sourceTimezone: string
  version: number
}
type CalendarView = 'day' | 'week' | 'month' | 'schedule'
type CalendarScope = 'ALL' | 'MINE' | 'TEAM'

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
  const companyId = user?.company?.id ?? ''
  const rawView = params.get('view')
  const view: CalendarView = rawView === 'day' || rawView === 'week' || rawView === 'schedule' || rawView === 'list'
    ? rawView === 'list' ? 'schedule' : rawView
    : 'month'
  const rawScope = params.get('scope')
  const scope: CalendarScope = rawScope === 'MINE' || rawScope === 'TEAM' ? rawScope : 'ALL'
  const requestedCreate = params.get('new') === '1'
  const selectedDate = params.get('date') ?? localDateKey(new Date())
  const date = new Date(`${selectedDate}T12:00:00`)
  const year = date.getFullYear()
  const month = date.getMonth()
  const range = useMemo(() => calendarRange(view, date), [view, selectedDate])
  const query = useQuery({
    queryKey: ['calendar', companyId, view, selectedDate, scope],
    queryFn: () => api<{
      items: CalendarEvent[]
      counts: Record<CalendarScope, number>
    }>(
      `/calendar/events?company=${encodeURIComponent(companyId || 'all')}&from=${range.from.toISOString()}&to=${range.to.toISOString()}&scope=${scope}`,
    ),
    enabled: Boolean(companyId),
  })
  const detail = useQuery({
    queryKey: ['calendar-event', eventId, companyId],
    queryFn: () => api<CalendarEvent | null>(
      `/calendar/events/${eventId}?company=${encodeURIComponent(companyId || 'all')}`,
    ),
    enabled: Boolean(eventId),
  })
  const update = useMutation({
    mutationFn: (input: {
      id: string
      title: string
      startAt: string
      endAt: string
      sourceTimezone: string
      allDay: boolean
      expectedVersion: number
    }) => api<{ id: string; version: number }>(`/calendar/events/${input.id}`, {
      method: 'PATCH',
      body: jsonBody({
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        sourceTimezone: input.sourceTimezone,
        allDay: input.allDay,
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: async () => {
      closeGuard.closeForSuccess(() => {
        setEditDirty(false)
        setEditOpen(false)
      })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['calendar'] }),
        client.invalidateQueries({ queryKey: ['calendar-event', eventId] }),
      ])
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
  const organizationId = user?.company?.id ?? ''
  const canCreate = canUseCapability(OrganizationCapability.CalendarWrite)
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

  function move(delta: number) {
    const next = new Date(date)
    if (view === 'day') next.setDate(next.getDate() + delta)
    else if (view === 'week') next.setDate(next.getDate() + (7 * delta))
    else next.setMonth(next.getMonth() + delta, 1)
    setParams((current) => {
      current.set('date', localDateKey(next))
      return current
    })
  }

  function moveToToday() {
    setParams((current) => {
      current.set('date', localDateKey(new Date()))
      return current
    })
  }

  return (
    <div>
      <PageHeader
        title="Календар"
        description="Робочі події та privacy-safe відсутності"
        action={
          <div className="calendar-actions">
            <div className="calendar-nav">
              <Button variant="secondary" onClick={moveToToday}>Сьогодні</Button>
              <Button variant="secondary" onClick={() => move(-1)} aria-label="Попередній місяць">
                <ChevronLeft size={17} />
              </Button>
              <strong>{calendarHeading(view, date)}</strong>
              <Button variant="secondary" onClick={() => move(1)} aria-label="Наступний місяць">
                <ChevronRight size={17} />
              </Button>
            </div>
            {canCreate && (
              <Button onClick={() => {
                setCreateDate(null)
                setCreateTitle('')
                setCreateOpen(true)
              }}>
                <CalendarPlus size={17} />
                Створити подію
              </Button>
            )}
          </div>
        }
      />
      <Card className="calendar-card">
        {query.isLoading ? (
          <Skeleton rows={6} />
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
              <Tabs
                value={scope}
                onChange={(value) => setParams((current) => {
                  if (value === 'ALL') current.delete('scope')
                  else current.set('scope', value)
                  return current
                })}
                items={[
                  { value: 'ALL', label: 'Усі', count: query.data?.counts.ALL },
                  { value: 'MINE', label: 'Мої', count: query.data?.counts.MINE },
                  { value: 'TEAM', label: 'Командні', count: query.data?.counts.TEAM },
                ]}
              />
            </div>
            {view === 'schedule' ? (
              query.data?.items.length ? (
                <div className="calendar-agenda">
                  {query.data.items.map((event) => (
                    <Link to={`/calendar/events/${event.id}?${params.toString()}`} key={event.id}>
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
                      (item) => localDateKey(new Date(item.startAt)) === iso,
                    ) ?? []
                    return (
                      <div
                        className={`${current ? '' : 'is-outside'} ${iso === localDateKey(new Date()) ? 'is-today' : ''}`}
                        key={iso}
                      >
                        {canCreate ? (
                          <button
                            type="button"
                            className="calendar-day-action"
                            aria-label={`Створити подію на ${new Intl.DateTimeFormat('uk-UA', {
                              day: 'numeric',
                              month: 'long',
                            }).format(day)}`}
                            onClick={() => {
                              setCreateDate(iso)
                              setCreateTitle('')
                              setCreateOpen(true)
                            }}
                          >
                            {day.getDate()}
                          </button>
                        ) : (
                          <span>{day.getDate()}</span>
                        )}
                        {events.slice(0, 3).map((event) => (
                          <Link to={`/calendar/events/${event.id}?${params.toString()}`} key={event.id}>
                            {event.title}
                          </Link>
                        ))}
                        {events.length > 3 && <small>+{events.length - 3}</small>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Card>
      {eventId && (
        <Drawer
          title={editOpen ? 'Редагувати подію' : 'Подія'}
          onRequestClose={closeGuard.requestClose}
          footer={selected && !editOpen && selected.ownerId === user?.id && canCreate ? (
            <Button variant="secondary" onClick={() => {
              setEditDirty(false)
              setEditOpen(true)
            }}>
              <Pencil size={16} />
              Редагувати
            </Button>
          ) : undefined}
        >
          {selected ? (
            editOpen ? (
              <form
                className="entity-form calendar-create"
                onChange={() => setEditDirty(true)}
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  update.mutate({
                    id: selected.id,
                    title: String(form.get('title') ?? ''),
                    startAt: new Date(String(form.get('startAt'))).toISOString(),
                    endAt: new Date(String(form.get('endAt'))).toISOString(),
                    sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || selected.sourceTimezone,
                    allDay: form.get('allDay') === 'on',
                    expectedVersion: selected.version,
                  })
                }}
              >
                <label className="span-2">
                  Назва
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={180}
                    defaultValue={selected.title}
                    autoFocus
                  />
                </label>
                <label>
                  Початок
                  <input
                    type="datetime-local"
                    name="startAt"
                    required
                    defaultValue={localDateTime(new Date(selected.startAt))}
                  />
                </label>
                <label>
                  Завершення
                  <input
                    type="datetime-local"
                    name="endAt"
                    required
                    defaultValue={localDateTime(new Date(selected.endAt))}
                  />
                </label>
                <label className="check-label span-2">
                  <input type="checkbox" name="allDay" defaultChecked={selected.allDay} />
                  Подія на весь день
                </label>
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
              </form>
            ) : (
              <div className="detail-stack">
                <h3>{selected.title}</h3>
                <p>
                  {selected.allDay
                    ? 'Увесь день'
                    : `${formatDateTime(selected.startAt)} — ${formatDateTime(selected.endAt)}`}
                </p>
                <p className="calendar-event-owner">
                  {selected.ownerId === user?.id ? 'Організатор: ви' : `Організатор: ${selected.ownerName}`}
                </p>
                <p className="privacy-note">
                  У календарі відображається лише інформація, дозволена учасникам події.
                </p>
              </div>
            )
          ) : detail.isLoading ? (
            <Skeleton />
          ) : (
            <EmptyState
              title="Подія недоступна"
              description="Можливо, її видалено або у вас немає доступу."
            />
          )}
        </Drawer>
      )}
      {createOpen && (
        <CalendarCreateDrawer
          organizationId={organizationId}
          initialDate={createDate}
          initialTitle={createTitle}
          closeGuard={closeGuard}
          onDirtyChange={setCreateDirty}
          onCreated={(id) => {
            setCreateDirty(false)
            setCreateOpen(false)
            void client.invalidateQueries({ queryKey: ['calendar'] })
            const next = new URLSearchParams(params)
            navigate(`/calendar/events/${id}?${next.toString()}`)
          }}
        />
      )}
      <UnsavedChangesDialog guard={closeGuard} />
    </div>
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
                  className={event.ownerId === currentUserId ? 'is-mine' : 'is-team'}
                  to={`/calendar/events/${event.id}${queryString ? `?${queryString}` : ''}`}
                  key={event.id}
                >
                  <time>
                    {event.allDay
                      ? 'Увесь день'
                      : new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.startAt))}
                  </time>
                  <strong>{event.title}</strong>
                  {event.ownerId !== currentUserId && <small>{event.ownerName}</small>}
                </Link>
              )) : <p>Вільно</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CalendarCreateDrawer({
  organizationId,
  initialDate,
  initialTitle,
  closeGuard,
  onDirtyChange,
  onCreated,
}: {
  organizationId: string
  initialDate: string | null
  initialTitle: string
  closeGuard: ModalCloseGuardController
  onDirtyChange: (dirty: boolean) => void
  onCreated: (id: string) => void
}) {
  const defaults = useRef(nextEventWindow(initialDate))
  const attempt = useRef({ signature: '', key: '' })
  const create = useMutation({
    mutationFn: (input: {
      companyId: string
      title: string
      startAt: string
      endAt: string
      sourceTimezone: string
      allDay: boolean
      key: string
    }) => api<{ id: string }>('/calendar/events', {
      method: 'POST',
      headers: { 'idempotency-key': input.key },
      body: jsonBody({
        companyId: input.companyId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        sourceTimezone: input.sourceTimezone,
        allDay: input.allDay,
      }),
    }),
    onSuccess: (result) => closeGuard.closeForSuccess(() => onCreated(result.id)),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = {
      companyId: String(form.get('companyId') ?? ''),
      title: String(form.get('title') ?? ''),
      startAt: new Date(String(form.get('startAt'))).toISOString(),
      endAt: new Date(String(form.get('endAt'))).toISOString(),
      sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv',
      allDay: form.get('allDay') === 'on',
    }
    const signature = JSON.stringify(input)
    if (attempt.current.signature !== signature) {
      attempt.current = { signature, key: idempotencyKey('calendar-event') }
    }
    create.mutate({ ...input, key: attempt.current.key })
  }

  return (
    <Drawer title="Нова подія" onRequestClose={closeGuard.requestClose}>
        <form className="entity-form calendar-create" onChange={() => onDirtyChange(true)} onSubmit={submit}>
          <input type="hidden" name="companyId" value={organizationId} />
          <label className="span-2">
            Назва
            <input name="title" required minLength={2} maxLength={180} autoFocus defaultValue={initialTitle} placeholder="Наприклад, зустріч команди" />
          </label>
          <label>
            Початок
            <input type="datetime-local" name="startAt" required defaultValue={defaults.current.start} />
          </label>
          <label>
            Завершення
            <input type="datetime-local" name="endAt" required defaultValue={defaults.current.end} />
          </label>
          <label className="check-label span-2">
            <input type="checkbox" name="allDay" />
            Подія на весь день
          </label>
          {create.isError && (
            <div className="form-error span-2" role="alert">
              Не вдалося створити подію. Перевірте час початку й завершення.
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
        </form>
    </Drawer>
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
  return new Date(event.startAt) < to && new Date(event.endAt) > from
}

function localDateKey(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
}

function localDateTime(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`
}
