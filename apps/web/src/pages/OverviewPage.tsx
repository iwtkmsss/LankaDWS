import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type {
  DashboardActivityItem,
  DashboardView,
  TaskStatus,
} from '@bert-crm/contracts'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  FileText,
  ListTodo,
  Megaphone,
  MessageCircle,
  Newspaper,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../shared/ui'

const statusOrder: TaskStatus[] = [
  'NEW',
  'PLANNED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
]

export default function OverviewPage() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardView>('/dashboard'),
  })
  if (query.isLoading) {
    return (
      <div className="overview-page">
        <PageHeader title="Огляд" />
        <div className="overview-loading">
          <Skeleton rows={3} />
          <Skeleton rows={5} />
        </div>
      </div>
    )
  }
  if (query.isError || !query.data || !user) {
    return <ErrorState onRetry={() => void query.refetch()} />
  }

  const data = query.data
  const firstName = user.displayName.split(' ')[0]
  const hasWorkingContent = data.tasks.length > 0
    || data.events.length > 0
    || data.announcements.length > 0
    || data.lifecycle.length > 0
    || data.activity.length > 0

  return (
    <div className="overview-page">
      <PageHeader title="Огляд" description="Стислий стан роботи на поточний момент" />

      <section className={`focus-panel ${data.attentionCount ? 'focus-panel--attention' : 'focus-panel--clear'}`}>
        <div className="focus-panel__intro">
          <span className="eyebrow">
            <Sparkles size={15} /> {formatLocalDate(data.meta.localDate)}
          </span>
          <h2>
            {firstName}, {data.attentionCount
              ? 'ось що зараз потребує уваги.'
              : 'термінових справ немає.'}
          </h2>
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

      {!hasWorkingContent && (
        <Card className="dashboard-full-empty">
          <EmptyState
            title="Робочий простір готовий"
            description="Нові завдання, події та оновлення з’являться тут автоматично."
            action={(
              <Link className="button button--primary" to={data.focus.primaryAction.href}>
                {data.focus.primaryAction.label}
              </Link>
            )}
          />
        </Card>
      )}

      {hasWorkingContent && (
        <div className="dashboard-grid">
          {data.availability.tasks && (
            <Card className="dashboard-card dashboard-card--tasks">
              <CardTitle title="Мої актуальні завдання" href="/tasks" linkLabel="Всі завдання" />
              {data.tasks.length ? (
                <ul className="entity-list">
                  {data.tasks.map((task) => (
                    <li key={task.id}>
                      <Link to={`/tasks/${task.id}`}>
                        <span className={`priority-dot priority-dot--${task.priority.toLowerCase()}`} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.number} · {task.deadline ? formatDate(task.deadline) : 'Без строку'}</small>
                        </span>
                        <StatusBadge status={task.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Активних завдань немає" description="Нові завдання з’являться тут." />
              )}
            </Card>
          )}

          {data.availability.calendar && (
            <Card className="dashboard-card">
              <CardTitle title="Найближчі події" href="/calendar" linkLabel="Відкрити календар" />
              {data.events.length ? (
                <ul className="timeline-list">
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <time>{formatDate(event.startAt)}</time>
                      <span>
                        <strong>{event.title}</strong>
                        <small>{event.allDay ? 'Увесь день' : formatDateTime(event.startAt)}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Календар вільний" description="Заплановані події з’являться тут." />
              )}
            </Card>
          )}

          {data.taskAnalytics && (
            <Card className="dashboard-card dashboard-card--analytics">
              <CardTitle title="Мої завдання за статусами" />
              <TaskAnalytics data={data.taskAnalytics} />
            </Card>
          )}

          {data.availability.activity && (
            <Card className="dashboard-card">
              <CardTitle title="Остання активність" href="/feed" linkLabel="Відкрити стрічку" />
              {data.activity.length ? (
                <ul className="dashboard-activity">
                  {data.activity.map((item) => (
                    <li key={item.id}>
                      <Link to={item.href}>
                        <ActivityIcon item={item} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.summary}</small>
                        </span>
                        <time>{formatDate(item.occurredAt)}</time>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Активності ще немає" description="Доступні оновлення з’являться тут." />
              )}
            </Card>
          )}

          {data.lifecycle.length > 0 && (
            <Card className="dashboard-card dashboard-card--wide">
              <CardTitle title="Активні кадрові процеси" />
              <div className="progress-cards">
                {data.lifecycle.map((item) => (
                  <Link
                    className="progress-card"
                    key={item.id}
                    to={`/${item.type === 'ONBOARDING' ? 'onboarding' : 'offboarding'}/${item.id}`}
                  >
                    <Avatar name={item.employeeName} />
                    <div>
                      <strong>{item.employeeName}</strong>
                      <small>{item.type === 'ONBOARDING' ? 'Онбординг' : 'Офбординг'}</small>
                      <div className="progress"><i style={{ width: `${item.progress}%` }} /></div>
                    </div>
                    <b>{item.progress}%</b>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {data.availability.announcements && (
            <Card className="dashboard-card dashboard-card--wide">
              <CardTitle title="Важливі оголошення" href="/announcements" linkLabel="Всі оголошення" />
              {data.announcements.length ? (
                <div className="announcement-strip">
                  {data.announcements.map((item) => (
                    <Link to={`/announcements/${item.id}`} key={item.id}>
                      <Megaphone size={20} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.safeSnippet}</small>
                      </span>
                      {item.isPinned && <b>Закріплено</b>}
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="Важливих оголошень немає" description="Новини організації з’являться тут." />
              )}
            </Card>
          )}
        </div>
      )}
    </div>
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

function TaskAnalytics({ data }: { data: NonNullable<DashboardView['taskAnalytics']> }) {
  const counts = statusOrder
    .map((status) => ({
      status,
      count: data.byStatus.find((item) => item.status === status)?.count ?? 0,
    }))
    .filter((item) => item.count > 0)
  const max = Math.max(1, ...counts.map((item) => item.count))
  return (
    <div className="task-analytics">
      <div className="task-analytics__bars">
        {counts.length ? counts.map((item) => (
          <div key={item.status}>
            <StatusBadge status={item.status} />
            <div className="task-analytics__track">
              <i style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} />
            </div>
            <strong>{item.count}</strong>
          </div>
        )) : <p>Активних завдань немає.</p>}
      </div>
      <div className="task-analytics__summary">
        <span><CheckCircle2 size={17} /><b>{data.completedLast7Days}</b><small>завершено за 7 днів</small></span>
        <span><AlertTriangle size={17} /><b>{data.overdue}</b><small>прострочено зараз</small></span>
      </div>
    </div>
  )
}

function ActivityIcon({ item }: { item: DashboardActivityItem }) {
  if (item.kind === 'POST') return <Newspaper size={17} />
  if (item.kind === 'TASK') return <CheckCircle2 size={17} />
  if (item.kind === 'EVENT') return <CalendarDays size={17} />
  if (item.kind === 'ANNOUNCEMENT') return <Megaphone size={17} />
  return <FileText size={17} />
}

function CardTitle({
  title,
  href,
  linkLabel,
}: {
  title: string
  href?: string
  linkLabel?: string
}) {
  return (
    <header className="card-title">
      <h2>{title}</h2>
      {href && linkLabel && (
        <Link to={href}>
          {linkLabel} <ArrowRight size={15} />
        </Link>
      )}
    </header>
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
