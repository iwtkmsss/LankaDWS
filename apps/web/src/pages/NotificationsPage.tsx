import { personNamesInLabel } from '../shared/lib/personName'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  HardDrive,
  ListTodo,
  Megaphone,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../shared/ui'

interface Notification {
  id: string
  safeTitle: string
  safeSnippet: string
  category: string
  entityType?: string | null
  entityId?: string | null
  readAt: string | null
  requiresAction: boolean
  createdAt: string
}
const labels: Record<string, string> = {
  APPROVALS: 'Погодження',
  CHAT: 'Чат',
  DIRECT: 'Особисте',
  DRIVE: 'Диск',
  FEED: 'Стрічка',
  MENTION: 'Згадка',
  SECURITY: 'Безпека',
  TASKS: 'Завдання',
  CALENDAR: 'Календар',
}
function icon(category: string) {
  if (category === 'DRIVE') return <HardDrive size={19} />
  if (category === 'TASKS') return <ListTodo size={19} />
  if (category === 'CHAT') return <MessageCircle size={19} />
  if (category === 'APPROVALS') return <CheckCircle2 size={19} />
  if (category === 'MENTION') return <BellRing size={19} />
  if (category === 'FEED') return <Megaphone size={19} />
  if (category === 'SECURITY') return <ShieldCheck size={19} />
  return <Bell size={19} />
}
function route(item: Notification, company: string | null) {
  const params = new URLSearchParams()
  if (company) params.set('company', company)
  const suffix = params.size ? `?${params}` : ''
  if (!item.entityId) return null
  if (item.entityType === 'DOCUMENT') return `/drive/${encodeURIComponent(item.entityId)}`
  if (item.entityType === 'DRIVE_FOLDER') return `/drive?folder=${encodeURIComponent(item.entityId)}`
  if (item.entityType === 'TASK') return `/tasks/${item.entityId}${suffix}`
  if (item.entityType === 'EVENT') return `/calendar/events/${encodeURIComponent(item.entityId)}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}${suffix}`
  if (item.entityType === 'FEED_POST') return `/feed?post=${encodeURIComponent(item.entityId)}`
  return item.entityType === 'USER' ? `/settings/security${suffix}` : null
}

export function NotificationsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'action'
  const company = params.get('company')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications', user?.id, tab],
    queryFn: () =>
      api<{ items: Notification[]; counts: { action: number; unread: number } }>(`/notifications?tab=${tab}`),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === user?.id ? previous : undefined,
  })
  const read = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api(`/notifications/${id}`, { method: 'PATCH', body: jsonBody({ read: value }) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readAll = useMutation({
    mutationFn: () => api<{ updated: number }>('/notifications/read-all', { method: 'PATCH', body: jsonBody({ tab }) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const unreadVisible = Boolean(query.data?.items.some((item) => !item.readAt))
  return (
    <div>
      <PageHeader
        title="Сповіщення"
        description="Одна черга важливих дій і робочих оновлень"
      />
      <Card className="list-card notification-center">
        <div className="list-toolbar">
          <Tabs
            value={tab}
            onChange={(value) =>
              setParams((current) => {
                current.set('tab', value)
                return current
              })
            }
            items={[
              { value: 'action', label: 'Потребує дії', count: query.data?.counts.action ?? 0 },
              { value: 'unread', label: 'Непрочитані', count: query.data?.counts.unread ?? 0 },
              { value: 'mentions', label: 'Згадки' },
              { value: 'all', label: 'Усі' },
            ]}
          />
          <Button variant="ghost" disabled={!unreadVisible || query.isFetching || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCircle2 size={16} />
            Позначити все прочитаним
          </Button>
        </div>
        {query.isLoading ? (
          <Skeleton rows={6} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="notification-list" aria-busy={query.isFetching}>
            {query.data.items.map((item) => {
              const target = route(item, company)
              return (
                <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                  <span className={`notification-icon notification-icon--${item.category.toLowerCase()}`}>
                    {icon(item.category)}
                  </span>
                  <div className="notification-copy">
                    <div>
                      <strong>{personNamesInLabel(item.safeTitle)}</strong>
                      {item.requiresAction && <em>Потрібна дія</em>}
                    </div>
                    <p>{item.safeSnippet}</p>
                    <small>
                      {labels[item.category] ?? 'Оновлення'} · {formatDateTime(item.createdAt)}
                    </small>
                  </div>
                  <div className="notification-actions">
                    {target && (
                      <Link
                        className="button button--secondary"
                        to={target}
                      >
                        Відкрити
                        <ArrowLeft className="notification-open-arrow" size={15} />
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      disabled={query.isPlaceholderData || (read.isPending && read.variables?.id === item.id)}
                      onClick={() => read.mutate({ id: item.id, value: !item.readAt })}
                    >
                      {item.readAt ? (
                        'Повернути в непрочитані'
                      ) : (
                        <>
                          <Check size={16} />
                          Прочитано
                        </>
                      )}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState title="Черга порожня" description="Тут немає сповіщень для вибраної вкладки." />
        )}
      </Card>
    </div>
  )
}
