import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AnnouncementListItem } from '@bert-crm/contracts'
import { Bell, Check, CheckCheck, Megaphone, MessageCircle, Pin, Plus, Send, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import {
  Avatar,
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
interface Thread {
  id: string
  title: string
  kind: string
  lastMessageAt: string | null
  lastMessage: string
  unread: boolean
}
interface Message {
  id: string
  authorId: string
  body: string
  createdAt: string
  author?: { id: string; displayName: string; avatarAsset?: string | null }
}
interface ThreadDetail {
  id: string
  title: string
  messages: Message[]
}

export default function CommunicationPages() {
  const path = useLocation().pathname
  if (path.startsWith('/announcements')) return <AnnouncementsPage />
  if (path.startsWith('/notifications')) return <NotificationsPage />
  return <MessagesPage />
}

function AnnouncementsPage() {
  const { announcementId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { can } = useAuth()
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
        description="Важливі новини для ваших компаній і ролей"
        action={
          can('announcements.create') && (
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
          <EmptyState title="Оголошень немає" description="Нові повідомлення компанії з’являться тут." />
        )}
      </Card>
      {announcementId && (
        <AnnouncementDrawer id={announcementId} onClose={() => navigate(`/announcements?${params.toString()}`)} />
      )}
    </div>
  )
}

function AnnouncementCreate() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
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
      companyIds: [user?.primaryCompanyId],
      isPinned: form.get('pinned') === 'on',
      publishAt: form.get('publishAt') || undefined,
    }
    try {
      const draft = await api<{ id: string; version: number }>('/announcements', {
        method: 'POST',
        body: jsonBody(input),
      })
      if (can('announcements.publish'))
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
      body: jsonBody({ companyIds: [user?.primaryCompanyId] }),
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
                Аудиторія: {user?.companies.find((item) => item.id === user.primaryCompanyId)?.displayName}
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
            <Button type="button" variant="secondary" onClick={() => navigate('/announcements')}>
              Скасувати
            </Button>
            <Button disabled={busy}>{can('announcements.publish') ? 'Опублікувати' : 'Зберегти чернетку'}</Button>
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
      onClose={onClose}
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

function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'action'
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
  return (
    <div>
      <PageHeader title="Сповіщення" description="Черги дій, згадки та важливі оновлення" />
      <Card className="list-card">
        <div className="list-toolbar">
          <Tabs
            value={tab}
            onChange={(value) => setParams({ tab: value })}
            items={[
              {
                value: 'action',
                label: 'Потребує дії',
                count: query.data?.counts.action,
              },
              { value: 'mentions', label: 'Згадки' },
              { value: 'today', label: 'Сьогодні' },
              { value: 'earlier', label: 'Раніше' },
            ]}
          />
        </div>
        {query.isLoading ? (
          <Skeleton rows={6} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="notification-list">
            {query.data.items.map((item) => (
              <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                <span>
                  <Bell size={19} />
                </span>
                <div>
                  <strong>{item.safeTitle}</strong>
                  <p>{item.safeSnippet}</p>
                  <small>
                    {formatDateTime(item.createdAt)} · {item.category}
                  </small>
                </div>
                <Button variant="ghost" onClick={() => read.mutate({ id: item.id, value: !item.readAt })}>
                  {item.readAt ? (
                    'Непрочитане'
                  ) : (
                    <>
                      <Check size={16} />
                      Прочитано
                    </>
                  )}
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Черга порожня" description="Тут немає сповіщень для вибраної вкладки." />
        )}
      </Card>
    </div>
  )
}

function MessagesPage() {
  const { threadId } = useParams()
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const client = useQueryClient()
  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => api<{ items: Thread[] }>('/messages/threads'),
  })
  const detail = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => api<ThreadDetail>(`/messages/threads/${threadId}`),
    enabled: Boolean(threadId),
  })
  const send = useMutation({
    mutationFn: (text: string) =>
      api(`/messages/threads/${threadId}/messages`, {
        method: 'POST',
        body: jsonBody({ body: text }),
      }),
    onSuccess: () => {
      setBody('')
      void client.invalidateQueries({ queryKey: ['thread', threadId] })
      void client.invalidateQueries({ queryKey: ['threads'] })
    },
  })
  return (
    <div>
      <PageHeader title="Повідомлення" description="Контекстні робочі діалоги, пов’язані з процесами" />
      <Card className="messages-layout">
        <aside>
          {threads.isLoading ? (
            <Skeleton />
          ) : (
            threads.data?.items.map((thread) => (
              <Link
                className={`${thread.id === threadId ? 'is-active' : ''} ${thread.unread ? 'is-unread' : ''}`}
                to={`/messages/${thread.id}`}
                key={thread.id}
              >
                <span>
                  <MessageCircle size={18} />
                </span>
                <div>
                  <strong>{thread.title}</strong>
                  <p>{thread.lastMessage || 'Новий діалог'}</p>
                  <small>{thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : ''}</small>
                </div>
              </Link>
            ))
          )}
        </aside>
        <section>
          {!threadId ? (
            <EmptyState title="Оберіть діалог" description="Історія та форма відповіді з’являться тут." />
          ) : detail.isLoading ? (
            <Skeleton />
          ) : detail.isError || !detail.data ? (
            <ErrorState />
          ) : (
            <>
              <header>
                <h2>{detail.data.title}</h2>
                <span>
                  <CheckCheck size={16} />
                  Контекст захищено
                </span>
              </header>
              <div className="chat-stream">
                {detail.data.messages.map((message) => (
                  <article className={message.authorId === user?.id ? 'is-own' : ''} key={message.id}>
                    {message.authorId !== user?.id && (
                      <Avatar
                        size="sm"
                        name={message.author?.displayName ?? 'Користувач'}
                        src={message.author?.avatarAsset}
                      />
                    )}
                    <div>
                      <strong>{message.author?.displayName}</strong>
                      <p>{message.body}</p>
                      <small>{formatDateTime(message.createdAt)}</small>
                    </div>
                  </article>
                ))}
              </div>
              <form
                className="chat-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (body.trim()) send.mutate(body)
                }}
              >
                <textarea
                  rows={2}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Написати повідомлення"
                />
                <Button aria-label="Надіслати" disabled={send.isPending}>
                  <Send size={18} />
                </Button>
              </form>
            </>
          )}
        </section>
      </Card>
    </div>
  )
}
