import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  ListTodo,
  Megaphone,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SendNotificationDrawer } from '../features/notifications/SendNotificationDrawer'
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
  FEED: 'Стрічка',
  MENTION: 'Згадка',
  SECURITY: 'Безпека',
  TASKS: 'Завдання',
}
function icon(category: string) {
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
  if (item.entityType === 'TASK') return `/tasks/${item.entityId}${suffix}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}${suffix}`
  if (item.entityType === 'FEED_POST') return item.requiresAction ? '/feed?filter=ACK_REQUIRED' : '/feed'
  return item.entityType === 'USER' ? `/settings/security${suffix}` : null
}

export function NotificationsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [sendOpen, setSendOpen] = useState(false)
  const [sentMessage, setSentMessage] = useState('')
  const tab = params.get('tab') ?? 'action'
  const company = params.get('company')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications', tab],
    queryFn: () =>
      api<{ items: Notification[]; counts: { action: number; unread: number } }>(`/notifications?tab=${tab}`),
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
        action={
          <div className="notification-header-actions">
            <Button
              onClick={() => {
                setSentMessage('')
                setSendOpen(true)
              }}
            >
              <BellRing size={17} />
              Надіслати сповіщення
            </Button>
            {query.data?.counts.unread ? (
              <span className="notification-summary" aria-live="polite">
                <strong>{query.data.counts.unread}</strong> непрочитаних
              </span>
            ) : null}
          </div>
        }
      />
      {sentMessage && (
        <p className="notification-send-status" role="status">
          {sentMessage}
        </p>
      )}
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
              { value: 'action', label: 'Потребує дії', count: query.data?.counts.action },
              { value: 'unread', label: 'Непрочитані', count: query.data?.counts.unread },
              { value: 'mentions', label: 'Згадки' },
              { value: 'all', label: 'Усі' },
            ]}
          />
          {unreadVisible && (
            <Button variant="ghost" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
              <CheckCircle2 size={16} />
              Позначити все прочитаним
            </Button>
          )}
        </div>
        {query.isLoading ? (
          <Skeleton rows={6} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="notification-list">
            {query.data.items.map((item) => {
              const target = route(item, company)
              return (
                <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                  <span className={`notification-icon notification-icon--${item.category.toLowerCase()}`}>
                    {icon(item.category)}
                  </span>
                  <div className="notification-copy">
                    <div>
                      <strong>{item.safeTitle}</strong>
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
                        onClick={() => {
                          if (!item.readAt) read.mutate({ id: item.id, value: true })
                        }}
                      >
                        Відкрити
                        <ArrowLeft className="notification-open-arrow" size={15} />
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      disabled={read.isPending && read.variables?.id === item.id}
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
      {sendOpen && (
        <SendNotificationDrawer
          companyId={user?.company?.id ?? 'all'}
          onClose={() => setSendOpen(false)}
          onSent={(contact) => {
            setSendOpen(false)
            setSentMessage(`Сповіщення для ${contact.displayName} надіслано.`)
            void client.invalidateQueries({ queryKey: ['notifications'] })
          }}
        />
      )}
    </div>
  )
}
