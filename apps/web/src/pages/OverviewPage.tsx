import { useQuery } from '@tanstack/react-query'
import { OrganizationCapability, type DashboardView } from '@bert-crm/contracts'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Megaphone,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { withCompanyScope } from '../shared/lib/navigation'
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../shared/ui'
import { FeedPage } from './FeedPage'

interface PrimaryFocus {
  title: string
  detail: string
  href: string
  action: string
}

export default function OverviewPage() {
  const { user, canUseCapability } = useAuth()
  return user && canUseCapability(OrganizationCapability.Feed) ? <FeedPage /> : <LegacyOverviewPage />
}

function LegacyOverviewPage() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardView>('/dashboard') })
  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Огляд" />
        <Skeleton rows={7} />
      </>
    )
  }
  if (query.isError || !query.data || !user) return <ErrorState onRetry={() => void query.refetch()} />

  const data = query.data
  const companyId = user.organization.id
  const scoped = (path: string) => withCompanyScope(path, companyId)
  const firstName = user.displayName.split(' ')[0]
  const focus = getPrimaryFocus(data, scoped)

  return (
    <div className="overview-page">
      <PageHeader title="Огляд" description="Ваші завдання й події на сьогодні" />
      <section className={`focus-panel ${data.attentionCount ? 'focus-panel--attention' : 'focus-panel--clear'}`}>
        <div className="focus-panel__intro">
          <span className="eyebrow">
            <Sparkles size={15} /> Сьогодні
          </span>
          <h2>{firstName}, {data.attentionCount ? 'ось ваш наступний крок.' : 'термінових справ немає.'}</h2>
          <p>
            {data.attentionCount
              ? `${data.attentionCount} ${data.attentionCount === 1 ? 'пункт потребує' : 'пункти потребують'} уваги.`
              : 'План дня та робочий контекст залишаються поруч.'}
          </p>
        </div>
        <div className="focus-panel__next">
          <span>Наступний крок</span>
          <strong>{focus.title}</strong>
          <small>{focus.detail}</small>
          <Link className="button button--primary" to={focus.href}>
            {focus.action} <ArrowRight size={16} />
          </Link>
        </div>
        <nav className="focus-panel__stats" aria-label="Швидкий перехід до плану дня">
          <Link to={scoped('/tasks')}>
            <CheckCircle2 size={18} />
            <span><strong>{data.tasks.length}</strong> активних завдань</span>
          </Link>
          <Link to={scoped('/calendar')}>
            <CalendarDays size={18} />
            <span><strong>{data.events.length}</strong> подій попереду</span>
          </Link>
        </nav>
      </section>

      <div className="dashboard-grid">
        <Card className="dashboard-card dashboard-card--tasks">
          <CardTitle title="Мої завдання" href={scoped('/tasks')} linkLabel="Всі завдання" />
          {data.tasks.length ? (
            <ul className="entity-list">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <Link to={scoped(`/tasks/${task.id}`)}>
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

        <Card className="dashboard-card">
          <CardTitle title="Найближчі події" href={scoped('/calendar')} linkLabel="Відкрити календар" />
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

        {data.lifecycle.length > 0 && (
          <Card className="dashboard-card dashboard-card--wide">
            <CardTitle title="Життєвий цикл" />
            <div className="progress-cards">
              {data.lifecycle.map((item) => (
                <Link
                  className="progress-card"
                  key={item.id}
                  to={scoped(`/${item.type === 'ONBOARDING' ? 'onboarding' : 'offboarding'}/${item.id}`)}
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

        <Card className="dashboard-card dashboard-card--wide">
          <CardTitle title="Оголошення" href={scoped('/announcements')} linkLabel="Всі оголошення" />
          {data.announcements.length ? (
            <div className="announcement-strip">
              {data.announcements.map((item) => (
                <Link to={scoped(`/announcements/${item.id}`)} key={item.id}>
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
            <EmptyState title="Нових оголошень немає" description="Важливі новини організації з’являться тут." />
          )}
        </Card>
      </div>
    </div>
  )
}

function getPrimaryFocus(data: DashboardView, scoped: (path: string) => string): PrimaryFocus {
  const task = data.tasks[0]
  if (task) {
    return {
      title: task.title,
      detail: `${task.number} · ${task.deadline ? `строк ${formatDate(task.deadline)}` : 'без строку'}`,
      href: scoped(`/tasks/${task.id}`),
      action: 'Відкрити завдання',
    }
  }
  const lifecycle = data.lifecycle[0]
  if (lifecycle) {
    return {
      title: `${lifecycle.type === 'ONBOARDING' ? 'Онбординг' : 'Офбординг'} · ${lifecycle.employeeName}`,
      detail: `${lifecycle.progress}% процесу завершено`,
      href: scoped(`/${lifecycle.type === 'ONBOARDING' ? 'onboarding' : 'offboarding'}/${lifecycle.id}`),
      action: 'Відкрити процес',
    }
  }
  const event = data.events[0]
  if (event) {
    return {
      title: event.title,
      detail: event.allDay ? `${formatDate(event.startAt)} · увесь день` : formatDateTime(event.startAt),
      href: scoped('/calendar'),
      action: 'Відкрити календар',
    }
  }
  return {
    title: 'Перевірте план на найближчі дні',
    detail: 'Календар допоможе спланувати наступний крок.',
    href: scoped('/calendar'),
    action: 'Відкрити календар',
  }
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
