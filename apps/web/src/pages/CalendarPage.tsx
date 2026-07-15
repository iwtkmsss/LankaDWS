import { useQuery } from '@tanstack/react-query'
import type { EventListItem } from '@bert-crm/contracts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import { formatDateTime } from '../shared/lib/format'
import { Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Skeleton } from '../shared/ui'

export default function CalendarPage() {
  const [params, setParams] = useSearchParams(); const { eventId } = useParams(); const navigate = useNavigate(); const date = params.get('date') ? new Date(`${params.get('date')}T12:00:00`) : new Date(); const year = date.getFullYear(); const month = date.getMonth()
  const from = new Date(year, month, 1); const to = new Date(year, month + 1, 1)
  const query = useQuery({ queryKey: ['calendar', year, month], queryFn: () => api<{ items: EventListItem[] }>(`/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}`) })
  const days = useMemo(() => { const result: Array<{ date: Date; current: boolean }> = []; const start = new Date(year, month, 1); const mondayIndex = (start.getDay() + 6) % 7; start.setDate(start.getDate() - mondayIndex); for (let index = 0; index < 42; index += 1) { const current = new Date(start); current.setDate(start.getDate() + index); result.push({ date: current, current: current.getMonth() === month }) } return result }, [year, month])
  function move(delta: number) { const next = new Date(year, month + delta, 1); setParams({ view: 'month', date: next.toISOString().slice(0, 10) }) }
  const selected = query.data?.items.find((item) => item.id === eventId)
  return <div><PageHeader title="Календар" description="Робочі події та privacy-safe відсутності" action={<div className="calendar-nav"><Button variant="secondary" onClick={() => move(-1)} aria-label="Попередній місяць"><ChevronLeft size={17} /></Button><strong>{new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(date)}</strong><Button variant="secondary" onClick={() => move(1)} aria-label="Наступний місяць"><ChevronRight size={17} /></Button></div>} />
    <Card className="calendar-card">{query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <><div className="calendar-weekdays">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((item) => <span key={item}>{item}</span>)}</div><div className="calendar-grid">{days.map(({ date: day, current }) => { const iso = day.toISOString().slice(0, 10); const events = query.data?.items.filter((item) => item.startAt.slice(0, 10) === iso) ?? []; return <div className={`${current ? '' : 'is-outside'} ${iso === new Date().toISOString().slice(0, 10) ? 'is-today' : ''}`} key={iso}><span>{day.getDate()}</span>{events.slice(0, 3).map((event) => <Link to={`/calendar/events/${event.id}?${params.toString()}`} key={event.id}>{event.title}</Link>)}{events.length > 3 && <small>+{events.length - 3}</small>}</div> })}</div></>}</Card>
    {eventId && <Drawer title="Подія" onClose={() => navigate(`/calendar?${params.toString()}`)}>{selected ? <div className="detail-stack"><h3>{selected.title}</h3><p>{selected.allDay ? 'Увесь день' : `${formatDateTime(selected.startAt)} — ${formatDateTime(selected.endAt)}`}</p><p className="privacy-note">У календарі відображається лише інформація, дозволена учасникам події.</p></div> : query.isLoading ? <Skeleton /> : <EmptyState title="Подія недоступна" description="Можливо, вона поза поточним місяцем або у вас немає доступу." />}</Drawer>}
  </div>
}
