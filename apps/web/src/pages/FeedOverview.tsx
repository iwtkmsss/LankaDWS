import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { DashboardView } from '@lankadws/contracts'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ListTodo,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate } from '../shared/lib/format'
import {
  ErrorState,
  PageDataLoader,
} from '../shared/ui'

function OverviewFocusPanel({ attention, children }: { attention: boolean; children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const panel = panelRef.current
    if (!frame || !panel || typeof ResizeObserver === 'undefined') return

    const updateHeight = () => {
      frame.style.height = `${panel.getBoundingClientRect().height}px`
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="overview-focus-frame" ref={frameRef}>
      <section ref={panelRef} className={`focus-panel ${attention ? 'focus-panel--attention' : 'focus-panel--clear'}`}>
        {children}
      </section>
    </div>
  )
}

export function FeedOverview() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardView>('/dashboard'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  if (query.isLoading) {
    return (
      <div className="feed-overview">
        <PageDataLoader />
      </div>
    )
  }
  if (query.isError || !query.data || !user) {
    return <ErrorState onRetry={() => void query.refetch()} />
  }

  const data = query.data
  const nextEvent = data.events?.[0]
  const firstName = user.firstName?.trim()
  return (
    <section className="feed-overview" aria-label="Робочий огляд">
      <OverviewFocusPanel attention={Boolean(data.attentionCount)}>
        <div className="focus-panel__intro">
          <span className="eyebrow">
            <Sparkles size={15} /> {formatLocalDate(data.meta.localDate)}
          </span>
          <h1>
            {firstName ? `${firstName}, ` : ''}{data.attentionCount
              ? 'ось що зараз потребує уваги.'
              : 'термінових справ немає.'}
          </h1>
          <p>
            {data.attentionCount
              ? `${data.attentionCount} ${attentionLabel(data.attentionCount)}.`
              : 'План дня та актуальний робочий контекст зібрані нижче.'}
          </p>
        </div>
      <section className="dashboard-kpis" aria-label="Ключові показники">
        {data.kpis.activeTasks && (
          <KpiCard
            icon={<ListTodo size={19} />}
            label="Активні завдання"
            tone="task"
            value={data.kpis.activeTasks.value}
            href={data.kpis.activeTasks.href}
          />
        )}
        {data.kpis.overdueTasks && (
          <KpiCard
            icon={<AlertTriangle size={19} />}
            label="Прострочені"
            value={data.kpis.overdueTasks.value}
            href={data.kpis.overdueTasks.href}
            tone="danger"
          />
        )}
        {data.kpis.events && (
          <KpiCard
            icon={<CalendarDays size={19} />}
            tone="calendar"
            label={data.kpis.events.todayCount
              ? 'Події сьогодні'
              : 'Найближча подія'}
            value={data.kpis.events.todayCount || nextEvent?.title || '—'}
            textValue={!data.kpis.events.todayCount && Boolean(nextEvent)}
            detail={!data.kpis.events.todayCount && data.kpis.events.nextAt
              ? formatDate(data.kpis.events.nextAt)
              : undefined}
            href={!data.kpis.events.todayCount && nextEvent
              ? `/calendar/events/${nextEvent.id}`
              : data.kpis.events.href}
          />
        )}
        {data.kpis.unreadMessages && (
          <KpiCard
            icon={<MessageCircle size={19} />}
            label="Непрочитані чати"
            value={data.kpis.unreadMessages.value}
            href={data.kpis.unreadMessages.href}
          />
        )}
      </section>
      </OverviewFocusPanel>

    </section>
  )
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  href,
  tone,
  textValue,
}: {
  icon: ReactNode
  label: string
  value: number | string
  detail?: string
  href: string
  tone?: 'danger' | 'task' | 'calendar'
  textValue?: boolean
}) {
  return (
    <Link className={`dashboard-kpi ${tone ? `dashboard-kpi--${tone}` : ''}`} to={href}>
      <i>{icon}</i>
      <span>
        <small>{label}</small>
        <strong className={textValue ? 'dashboard-kpi__text-value' : undefined} title={textValue ? String(value) : undefined}>{value}</strong>
        {detail && <em>{detail}</em>}
      </span>
      <ArrowRight size={15} />
    </Link>
  )
}

function formatLocalDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed)
}

function attentionLabel(value: number): string {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return 'пункт потребує уваги'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'пункти потребують уваги'
  }
  return 'пунктів потребують уваги'
}
