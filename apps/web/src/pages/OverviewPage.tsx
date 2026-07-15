import { useQuery } from '@tanstack/react-query'
import type { DashboardView } from '@bert-crm/contracts'
import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Clock3, Megaphone, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../shared/ui'

const roleAsset: Record<string, string> = { Працівник: 'employee', Керівник: 'manager', HR: 'hr', Адміністратор: 'admin' }

export default function OverviewPage() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardView>('/dashboard') })
  if (query.isLoading) return <><PageHeader title="Огляд" /><Skeleton rows={7} /></>
  if (query.isError || !query.data || !user) return <ErrorState onRetry={() => void query.refetch()} />
  const data = query.data
  const firstName = user.displayName.split(' ')[0]
  const asset = roleAsset[user.displayRole] ?? 'employee'
  return <div className="overview-page">
    <PageHeader title="Огляд" description="Особистий робочий простір без зайвої командної аналітики" />
    <section className="welcome-card"><div><span className="eyebrow"><Sparkles size={15} /> Сьогодні у BERT</span><h2>Вітаємо, {firstName}.</h2><p>{data.attentionCount ? `Є ${data.attentionCount} ${data.attentionCount === 1 ? 'пункт' : 'пункти'}, що потребують уваги.` : 'На зараз усе під контролем.'}</p><div className="welcome-chips"><span><CheckCircle2 size={15} />{data.tasks.length} активних задач</span><span><CalendarDays size={15} />{data.events.length} подій попереду</span></div></div><img src={`/assets/heroes/${asset}-overview.webp`} alt="" width="400" height="260" /></section>
    <div className="dashboard-grid">
      <Card className="dashboard-card dashboard-card--tasks"><CardTitle title="Мої завдання" href="/tasks" />{data.tasks.length ? <ul className="entity-list">{data.tasks.map((task) => <li key={task.id}><Link to={`/tasks/${task.id}`}><span className={`priority-dot priority-dot--${task.priority.toLowerCase()}`} /><span><strong>{task.title}</strong><small>{task.number} · {task.deadline ? formatDate(task.deadline) : 'Без строку'}</small></span><StatusBadge status={task.status} /></Link></li>)}</ul> : <EmptyState title="Завдань немає" description="Нові завдання з’являться тут." />}</Card>
      {data.decisions.length > 0 && <Card className="dashboard-card"><CardTitle title="Потребують рішення" href="/requests?tab=approval" /><ul className="entity-list">{data.decisions.map((request) => <li key={request.id}><Link to={`/requests/${request.id}`}><CircleAlert size={18} /><span><strong>{request.safeSummary}</strong><small>{request.number} · SLA {request.slaDueAt ? formatDateTime(request.slaDueAt) : '—'}</small></span><StatusBadge status={request.decisionStatus} /></Link></li>)}</ul></Card>}
      <Card className="dashboard-card"><CardTitle title="Мої заявки" href="/requests" />{data.requests.length ? <ul className="entity-list">{data.requests.map((request) => <li key={request.id}><Link to={`/requests/${request.id}`}><Clock3 size={18} /><span><strong>{request.type}</strong><small>{request.safeSummary}</small></span><StatusBadge status={request.decisionStatus} /></Link></li>)}</ul> : <EmptyState title="Заявок немає" description="Створіть відпустку або інший запит." />}</Card>
      <Card className="dashboard-card"><CardTitle title="Найближчі події" href="/calendar" />{data.events.length ? <ul className="timeline-list">{data.events.map((event) => <li key={event.id}><time>{formatDate(event.startAt)}</time><span><strong>{event.title}</strong><small>{event.allDay ? 'Увесь день' : formatDateTime(event.startAt)}</small></span></li>)}</ul> : <EmptyState title="Календар вільний" description="Заплановані події з’являться тут." />}</Card>
      {data.lifecycle.length > 0 && <Card className="dashboard-card dashboard-card--wide"><CardTitle title="Життєвий цикл" href="#" /><div className="progress-cards">{data.lifecycle.map((item) => <article key={item.id}><Avatar name={item.employeeName} /><div><strong>{item.employeeName}</strong><small>{item.type === 'ONBOARDING' ? 'Онбординг' : 'Офбординг'}</small><div className="progress"><i style={{ width: `${item.progress}%` }} /></div></div><b>{item.progress}%</b></article>)}</div></Card>}
      <Card className="dashboard-card dashboard-card--wide"><CardTitle title="Оголошення" href="/announcements" />{data.announcements.length ? <div className="announcement-strip">{data.announcements.map((item) => <Link to={`/announcements/${item.id}`} key={item.id}><Megaphone size={20} /><span><strong>{item.title}</strong><small>{item.safeSnippet}</small></span>{item.isPinned && <b>Закріплено</b>}</Link>)}</div> : <EmptyState title="Нових оголошень немає" description="Важливі новини компанії з’являться тут." />}</Card>
    </div>
  </div>
}

function CardTitle({ title, href }: { title: string; href: string }) { return <header className="card-title"><h2>{title}</h2>{href !== '#' && <Link to={href}>Усі <ArrowRight size={15} /></Link>}</header> }
