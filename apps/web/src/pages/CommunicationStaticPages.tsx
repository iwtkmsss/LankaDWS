import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { AnnouncementListItem } from '@bert-crm/contracts'
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  ListTodo,
  Megaphone,
  MessageCircle,
  Pin,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
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
  StatusBadge,
  Tabs,
} from '../shared/ui'

interface AnnouncementDetail {
  id: string
  title: string
  body: string
  status: string
  version: number
  isPinned: boolean
  publishAt: string | null
  createdAt: string
  receipt: { readAt: string | null }
  audience: { companyIds: string[]; roleIds: string[]; userIds: string[] }
}
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

const notificationCategoryLabels: Record<string, string> = {
  APPROVALS: 'Погодження',
  CHAT: 'Чат',
  FEED: 'Стрічка',
  MENTION: 'Згадка',
  SECURITY: 'Безпека',
  TASKS: 'Завдання',
}

function notificationIcon(category: string) {
  if (category === 'TASKS') return <ListTodo size={19} />
  if (category === 'CHAT') return <MessageCircle size={19} />
  if (category === 'APPROVALS') return <CheckCircle2 size={19} />
  if (category === 'MENTION') return <BellRing size={19} />
  if (category === 'FEED') return <Megaphone size={19} />
  if (category === 'SECURITY') return <ShieldCheck size={19} />
  return <Bell size={19} />
}

function notificationRoute(item: Notification, company: string | null) {
  const params = new URLSearchParams()
  if (company) params.set('company', company)
  const scopedQuery = params.toString()
  const suffix = scopedQuery ? `?${scopedQuery}` : ''
  if (!item.entityId) return null
  if (item.entityType === 'TASK') return `/tasks/${item.entityId}${suffix}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}${suffix}`
  if (item.entityType === 'FEED_POST') {
    return item.requiresAction ? '/feed?filter=ACK_REQUIRED' : '/feed'
  }
  if (item.entityType === 'USER') return `/settings/security${suffix}`
  return null
}

export function AnnouncementsPage() {
  const { announcementId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const state = params.get('tab') ?? 'active'
  const query = useQuery({
    queryKey: ['announcements', state],
    queryFn: () => api<{ items: AnnouncementListItem[] }>(`/announcements?state=${state}`),
    enabled: location.pathname !== '/announcements/new',
  })
  if (location.pathname === '/announcements/new') return <AnnouncementCreate />
  return (
    <div>
      <PageHeader
        title="Оголошення"
        description="Важливі новини для організації та ваших ролей"
        action={
          (
            <Link className="button button--primary" to="/announcements/new">
              <Plus size={17} />
              Створити
            </Link>
          )
        }
      />
      <Card className="list-card">
        <div className="list-toolbar">
          <Tabs
            value={state}
            onChange={(value) => setParams({ tab: value })}
            items={[
              { value: 'active', label: 'Актуальні' },
              { value: 'archive', label: 'Архів' },
            ]}
          />
        </div>
        {query.isLoading ? (
          <Skeleton rows={6} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="announcement-list">
            {query.data.items.map((item) => (
              <Link
                to={`/announcements/${item.id}?${params.toString()}`}
                key={item.id}
                className={item.readAt ? '' : 'is-unread'}
              >
                <span className="announcement-list__icon">
                  <Megaphone size={20} />
                </span>
                <div>
                  <div>
                    <h2>{item.title}</h2>
                    {item.isPinned && (
                      <span className="pin">
                        <Pin size={13} />
                        Закріплено
                      </span>
                    )}
                  </div>
                  <p>{item.safeSnippet}</p>
                  <small>
                    {item.authorName} · {item.publishedAt ? formatDateTime(item.publishedAt) : 'Заплановано'}
                  </small>
                </div>
                {!item.readAt && <i />}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="Оголошень немає" description="Нові повідомлення організації з’являться тут." />
        )}
      </Card>
      {announcementId && (
        <AnnouncementDrawer id={announcementId} onClose={() => navigate(`/announcements?${params.toString()}`)} />
      )}
    </div>
  )
}

function AnnouncementCreate() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const selectedCompanyId = user?.company?.id ?? ''
  const [preview, setPreview] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const input = {
      title: form.get('title'),
      body: form.get('body'),
      companyIds: [selectedCompanyId],
      isPinned: form.get('pinned') === 'on',
      publishAt: form.get('publishAt') || undefined,
    }
    try {
      const draft = await api<{ id: string; version: number }>('/announcements', {
        method: 'POST',
        body: jsonBody(input),
      })
      await api(`/announcements/${draft.id}/publish`, {
        method: 'POST',
        body: jsonBody({ expectedVersion: draft.version }),
      })
      navigate('/announcements', { replace: true })
    } catch {
      setError('Не вдалося зберегти оголошення або опублікувати його.')
    } finally {
      setBusy(false)
    }
  }
  async function audience() {
    const result = await api<{ recipientCount: number }>('/announcements/audience-preview', {
      method: 'POST',
      body: jsonBody({ companyIds: [selectedCompanyId] }),
    })
    setPreview(result.recipientCount)
  }
  return (
    <div>
      <PageHeader
        title="Нове оголошення"
        description="Спочатку створюється чернетка, потім — контрольована публікація"
      />
      <Card className="form-card">
        <form className="entity-form" onSubmit={submit}>
          <label className="span-2">
            Заголовок
            <input name="title" required maxLength={180} autoFocus />
          </label>
          <label className="span-2">
            Текст
            <textarea name="body" rows={10} required maxLength={10000} />
          </label>
          <label>
            Час публікації <span className="optional">необов’язково</span>
            <input type="datetime-local" name="publishAt" />
          </label>
          <label className="check-label">
            <input type="checkbox" name="pinned" />
            Закріпити у верхній частині
          </label>
          <div className="audience-preview span-2">
            <ShieldCheck size={18} />
            <span>
              <strong>
                Аудиторія: вся організація
              </strong>
              <small>
                {preview === null
                  ? 'Перевірте кількість отримувачів перед публікацією.'
                  : `${preview} отримувачів матимуть доступ.`}
              </small>
            </span>
            <Button type="button" variant="secondary" onClick={() => void audience()}>
              Перевірити
            </Button>
          </div>
          {error && <div className="form-error span-2">{error}</div>}
          <div className="form-actions span-2">
            <Button type="button" variant="secondary" onClick={() => navigate(`/announcements?company=${encodeURIComponent(selectedCompanyId)}`)}>
              Скасувати
            </Button>
            <Button disabled={busy}>Опублікувати</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function AnnouncementDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['announcement', id],
    queryFn: () => api<AnnouncementDetail>(`/announcements/${id}`),
  })
  const client = useQueryClient()
  const read = useMutation({
    mutationFn: (value: boolean) =>
      api(`/announcements/${id}/read`, {
        method: 'POST',
        body: jsonBody({ read: value }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['announcement', id] })
      void client.invalidateQueries({ queryKey: ['announcements'] })
    },
  })
  const shouldMarkRead = Boolean(query.data && !query.data.receipt.readAt)
  const markRead = read.mutate
  useEffect(() => {
    if (shouldMarkRead) markRead(true)
  }, [markRead, shouldMarkRead])
  return (
    <Drawer
      title="Оголошення"
      onRequestClose={() => onClose()}
      footer={
        query.data && (
          <Button variant="secondary" onClick={() => read.mutate(Boolean(!query.data?.receipt.readAt))}>
            {query.data.receipt.readAt ? 'Позначити непрочитаним' : 'Позначити прочитаним'}
          </Button>
        )
      }
    >
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <article className="announcement-detail">
          {query.data.isPinned && (
            <span className="pin">
              <Pin size={13} />
              Закріплено
            </span>
          )}
          <h2>{query.data.title}</h2>
          <p className="article-meta">
            {query.data.publishAt ? formatDateTime(query.data.publishAt) : 'Чернетка'} ·{' '}
            <StatusBadge status={query.data.status} />
          </p>
          <div>
            {query.data.body.split('\n').map((text, index) => (
              <p key={index}>{text}</p>
            ))}
          </div>
          <aside>
            <ShieldCheck size={17} />
            Аудиторію перевірено сервером. Технічні ID приховано.
          </aside>
        </article>
      )}
    </Drawer>
  )
}

export function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'action'
  const company = params.get('company')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications', tab],
    queryFn: () =>
      api<{
        items: Notification[]
        counts: { action: number; unread: number }
      }>(`/notifications?tab=${tab}`),
  })
  const read = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api(`/notifications/${id}`, {
        method: 'PATCH',
        body: jsonBody({ read: value }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readAll = useMutation({
    mutationFn: () =>
      api<{ updated: number }>('/notifications/read-all', {
        method: 'PATCH',
        body: jsonBody({ tab }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const unreadVisible = Boolean(query.data?.items.some((item) => !item.readAt))
  return (
    <div>
      <PageHeader
        title="Сповіщення"
        description="Одна черга важливих дій і робочих оновлень"
        action={query.data?.counts.unread ? (
          <span className="notification-summary" aria-live="polite">
            <strong>{query.data.counts.unread}</strong>
            непрочитаних
          </span>
        ) : undefined}
      />
      <Card className="list-card notification-center">
        <div className="list-toolbar">
          <Tabs
            value={tab}
            onChange={(value) => setParams((current) => {
              current.set('tab', value)
              return current
            })}
            items={[
              {
                value: 'action',
                label: 'Потребує дії',
                count: query.data?.counts.action,
              },
              {
                value: 'unread',
                label: 'Непрочитані',
                count: query.data?.counts.unread,
              },
              { value: 'mentions', label: 'Згадки' },
              { value: 'all', label: 'Усі' },
            ]}
          />
          {unreadVisible && (
            <Button
              variant="ghost"
              disabled={readAll.isPending}
              onClick={() => readAll.mutate()}
            >
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
              const route = notificationRoute(item, company)
              return (
                <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                  <span className={`notification-icon notification-icon--${item.category.toLowerCase()}`}>
                    {notificationIcon(item.category)}
                  </span>
                  <div className="notification-copy">
                    <div>
                      <strong>{item.safeTitle}</strong>
                      {item.requiresAction && <em>Потрібна дія</em>}
                    </div>
                    <p>{item.safeSnippet}</p>
                    <small>
                      {notificationCategoryLabels[item.category] ?? 'Оновлення'} · {formatDateTime(item.createdAt)}
                    </small>
                  </div>
                  <div className="notification-actions">
                    {route && (
                      <Link
                        className="button button--secondary"
                        to={route}
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
                      {item.readAt ? 'Повернути в непрочитані' : (
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
