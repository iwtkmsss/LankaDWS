import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DashboardView } from '@lankadws/contracts'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  ListTodo,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import {
  ErrorState,
  PageDataLoader,
} from '../shared/ui'

export function FeedOverview() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardView>('/dashboard'),
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
  const firstName = user.displayName.split(' ')[0]
  return (
    <section className="feed-overview" aria-label="Робочий огляд">
      <section className={`focus-panel ${data.attentionCount ? 'focus-panel--attention' : 'focus-panel--clear'}`}>
        <div className="focus-panel__intro">
          <span className="eyebrow">
            <Sparkles size={15} /> {formatLocalDate(data.meta.localDate)}
          </span>
          <h1>
            {firstName}, {data.attentionCount
              ? 'ось що зараз потребує уваги.'
              : 'термінових справ немає.'}
          </h1>
          <p>
            {data.attentionCount
              ? `${data.attentionCount} ${attentionLabel(data.attentionCount)}.`
              : 'План дня та актуальний робочий контекст зібрані нижче.'}
          </p>
        </div>
        <div className="focus-panel__next">
          <span>Наступний крок</span>
          <strong>{data.focus.nextStep?.title ?? 'Робочий план актуальний'}</strong>
          <small>
            {formatFocusDetail(data.focus.nextStep?.detail)
              ?? 'Нові важливі пункти з’являться тут.'}
          </small>
          <Link className="button button--primary" to={data.focus.primaryAction.href}>
            {data.focus.primaryAction.label} <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="dashboard-kpis" aria-label="Ключові показники">
        {data.kpis.activeTasks && (
          <KpiCard
            icon={<ListTodo size={19} />}
            label="Активні завдання"
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
            label={data.kpis.events.todayCount
              ? 'Події сьогодні'
              : 'Найближча подія'}
            value={data.kpis.events.todayCount || '—'}
            detail={!data.kpis.events.todayCount && data.kpis.events.nextAt
              ? formatDate(data.kpis.events.nextAt)
              : undefined}
            href={data.kpis.events.href}
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
        {data.kpis.unreadNotifications && (
          <KpiCard
            icon={<Bell size={19} />}
            label="Нові сповіщення"
            value={data.kpis.unreadNotifications.value}
            href={data.kpis.unreadNotifications.href}
          />
        )}
      </section>

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
}: {
  icon: ReactNode
  label: string
  value: number | string
  detail?: string
  href: string
  tone?: 'danger'
}) {
  return (
    <Link className={`dashboard-kpi ${tone ? `dashboard-kpi--${tone}` : ''}`} to={href}>
      <i>{icon}</i>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
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

function formatFocusDetail(value: string | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : formatDateTime(value)
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
