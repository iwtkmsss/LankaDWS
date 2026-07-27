import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AnnouncementListItem,
  ChatAttachmentView,
  ChatMessageView,
  ChatParticipantView,
  ChatThreadDetail,
  ChatThreadListItem,
} from '@bert-crm/contracts'
import { OrganizationCapability } from '@bert-crm/contracts'
import {
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  CalendarPlus,
  Check,
  CheckCircle2,
  Crown,
  FileText,
  LoaderCircle,
  LogOut,
  ListTodo,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, apiUrl, idempotencyKey, jsonBody } from '../shared/api/client'
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

const notificationCategoryLabels: Record<string, string> = {
  APPROVALS: 'Погодження',
  CHAT: 'Чат',
  FEED: 'Стрічка',
  MENTION: 'Згадка',
  REQUESTS: 'Заявки',
  SECURITY: 'Безпека',
  TASKS: 'Завдання',
}

function notificationIcon(category: string) {
  if (category === 'TASKS') return <ListTodo size={19} />
  if (category === 'CHAT') return <MessageCircle size={19} />
  if (category === 'APPROVALS') return <CheckCircle2 size={19} />
  if (category === 'REQUESTS') return <FileText size={19} />
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
  if (item.entityType === 'REQUEST') return `/requests/${item.entityId}${suffix}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}${suffix}`
  if (item.entityType === 'FEED_POST') {
    if (item.requiresAction) params.set('filter', 'ACK_REQUIRED')
    const feedQuery = params.toString()
    return `/overview${feedQuery ? `?${feedQuery}` : ''}`
  }
  if (item.entityType === 'USER') return `/settings/security${suffix}`
  return null
}

interface ChatEmployee {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset: string | null
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
        description="Важливі новини для організації та ваших ролей"
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
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const selectedCompanyId = user?.organization.id ?? ''
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

function MessagesPage() {
  const { threadId } = useParams()
  const { user, can, canUseCapability } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([])
  const [uploadError, setUploadError] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [conversion, setConversion] = useState<{
    kind: 'task' | 'event'
    message: ChatMessageView
  } | null>(null)
  const markedReadRef = useRef('')
  const sendAttemptRef = useRef({ signature: '', key: '' })
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const client = useQueryClient()
  const companyId = user?.organization.id ?? ''
  const search = params.get('q') ?? ''
  const unreadOnly = params.get('unread') === 'true'
  const isCreating = params.get('new') === '1'
  const listQuery = new URLSearchParams()
  if (companyId) listQuery.set('company', companyId)
  if (search) listQuery.set('query', search)
  if (unreadOnly) listQuery.set('unread', 'true')
  const threads = useQuery({
    queryKey: ['threads', companyId, search, unreadOnly],
    queryFn: () => api<{
      items: ChatThreadListItem[]
      counts: { all: number; unread: number }
    }>(`/messages/threads?${listQuery.toString()}`),
    enabled: Boolean(companyId),
    refetchInterval: realtimeConnected ? false : 15_000,
    refetchIntervalInBackground: false,
  })
  const detail = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => api<ChatThreadDetail>(`/messages/threads/${threadId}`),
    enabled: Boolean(threadId),
    refetchInterval: (query) => query.state.data?.messages.some((message) =>
      message.attachments.some((attachment) =>
        attachment.scanStatus === 'QUARANTINED' || attachment.scanStatus === 'SCANNING',
      ),
    ) ? 2_500 : realtimeConnected ? false : 5_000,
    refetchIntervalInBackground: false,
  })
  const canConvertToTask = can('tasks.create')
  const canConvertToEvent = can('calendar.manage')
    && Boolean(detail.data?.companyId)
    && canUseCapability(OrganizationCapability.CalendarWrite)

  useEffect(() => {
    setRealtimeConnected(false)
    if (!threadId || typeof EventSource === 'undefined') return

    const source = new EventSource(apiUrl(`/messages/threads/${threadId}/events`), {
      withCredentials: true,
    })
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ['thread', threadId] })
      void client.invalidateQueries({ queryKey: ['threads'] })
    }
    const markConnected = () => setRealtimeConnected(true)
    const reset = () => {
      setRealtimeConnected(false)
      source.close()
      refresh()
    }

    source.addEventListener('ready', markConnected)
    source.addEventListener('chat', refresh)
    source.addEventListener('reset', reset)
    source.onerror = () => setRealtimeConnected(false)

    return () => {
      source.close()
      setRealtimeConnected(false)
    }
  }, [client, threadId])

  const send = useMutation({
    mutationFn: (input: {
      text: string
      replyToId: string | null
      attachmentIds: string[]
      key: string
    }) =>
      api(`/messages/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'idempotency-key': input.key },
        body: jsonBody({
          body: input.text,
          replyToId: input.replyToId,
          attachmentIds: input.attachmentIds,
        }),
      }),
    onSuccess: () => {
      setBody('')
      setReplyTo(null)
      setAttachments([])
      setUploadError('')
      sendAttemptRef.current = { signature: '', key: '' }
      void client.invalidateQueries({ queryKey: ['thread', threadId] })
      void client.invalidateQueries({ queryKey: ['threads'] })
    },
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results = await Promise.allSettled(files.map(async (file) => {
        const form = new FormData()
        form.append('file', file)
        return api<ChatAttachmentView>(`/messages/threads/${threadId}/attachments`, {
          method: 'POST',
          body: form,
        })
      }))
      return {
        uploaded: results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
        failed: results.filter((result) => result.status === 'rejected').length,
      }
    },
    onSuccess: ({ uploaded, failed }) => {
      setAttachments((current) => [...current, ...uploaded].slice(0, 5))
      setUploadError(failed ? `Не вдалося додати ${failed} файл(и). Перевірте формат і розмір.` : '')
    },
    onError: () => {
      setUploadError('Не вдалося додати файл. Спробуйте ще раз.')
    },
  })
  const editMessage = useMutation({
    mutationFn: (input: { id: string; body: string; expectedVersion: number }) =>
      api(`/messages/${input.id}`, {
        method: 'PATCH',
        body: jsonBody({ body: input.body, expectedVersion: input.expectedVersion }),
      }),
    onSuccess: async () => {
      setEditingMessageId(null)
      setEditBody('')
      await Promise.all([
        client.invalidateQueries({ queryKey: ['thread', threadId] }),
        client.invalidateQueries({ queryKey: ['threads'] }),
      ])
    },
  })
  const deleteMessage = useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api(`/messages/${input.id}`, {
        method: 'DELETE',
        body: jsonBody({ expectedVersion: input.expectedVersion }),
      }),
    onSuccess: async () => {
      setDeletingMessageId(null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['thread', threadId] }),
        client.invalidateQueries({ queryKey: ['threads'] }),
      ])
    },
  })
  const markRead = useMutation({
    mutationFn: (lastReadMessageId: string) =>
      api(`/messages/threads/${threadId}/read`, {
        method: 'POST',
        body: jsonBody({ lastReadMessageId }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['thread', threadId] })
      void client.invalidateQueries({ queryKey: ['threads'] })
    },
    onError: () => {
      markedReadRef.current = ''
    },
  })
  const preference = useMutation({
    mutationFn: (input: { notificationMode: 'ALL' | 'NONE'; expectedVersion: number }) =>
      api(`/messages/threads/${threadId}/preferences`, {
        method: 'PUT',
        body: jsonBody(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['thread', threadId] })
      void client.invalidateQueries({ queryKey: ['threads'] })
    },
  })
  const lastMessageId = detail.data?.lastMessageId ?? null
  useEffect(() => {
    const marker = threadId && lastMessageId ? `${threadId}:${lastMessageId}` : ''
    if (!marker || markedReadRef.current === marker) return
    markedReadRef.current = marker
    markRead.mutate(lastMessageId!)
  }, [lastMessageId, markRead.mutate, threadId])
  useEffect(() => {
    if (detail.data?.messages.length) streamEndRef.current?.scrollIntoView({ block: 'end' })
  }, [detail.data?.messages.length])
  useEffect(() => {
    setReplyTo(null)
    setAttachments([])
    setUploadError('')
    setEditingMessageId(null)
    setDeletingMessageId(null)
    setConversion(null)
    setParticipantsOpen(false)
    sendAttemptRef.current = { signature: '', key: '' }
  }, [threadId])

  function updateParam(key: string, value?: string) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const pageAction = can('messages.write') ? (
    <Button onClick={() => updateParam('new', '1')}>
      <Plus size={17} />
      Новий діалог
    </Button>
  ) : undefined

  return (
    <div className={`messages-page ${threadId ? 'has-open-thread' : ''}`}>
      <PageHeader
        title="Чат"
        description="Приватні робочі діалоги без зайвого інформаційного шуму"
        action={pageAction}
      />
      <Card className={`messages-layout ${threadId ? 'has-thread' : 'is-list-only'}`}>
        <aside aria-label="Діалоги">
          <div className="messages-sidebar__toolbar">
            <label className="search-field">
              <span className="sr-only">Знайти діалог або повідомлення</span>
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => updateParam('q', event.target.value)}
                placeholder="Діалог або повідомлення"
              />
              {search && (
                <button type="button" aria-label="Очистити пошук" onClick={() => updateParam('q')}>
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="messages-filter" aria-label="Фільтр діалогів">
              <button
                type="button"
                className={!unreadOnly ? 'is-active' : ''}
                onClick={() => updateParam('unread')}
              >
                Усі
                <span>{threads.data?.counts.all ?? 0}</span>
              </button>
              <button
                type="button"
                className={unreadOnly ? 'is-active' : ''}
                onClick={() => updateParam('unread', 'true')}
              >
                Непрочитані
                <span>{threads.data?.counts.unread ?? 0}</span>
              </button>
            </div>
          </div>
          {threads.isLoading ? (
            <Skeleton rows={6} />
          ) : threads.isError ? (
            <ErrorState title="Не вдалося завантажити діалоги" />
          ) : threads.data?.items.length ? (
            <nav className="messages-thread-list">
              {threads.data.items.map((thread) => (
                <Link
                  className={`${thread.id === threadId ? 'is-active' : ''} ${thread.unread ? 'is-unread' : ''}`}
                  to={`/messages/${thread.id}?${params.toString()}`}
                  key={thread.id}
                >
                  <Avatar size="sm" name={thread.title} src={thread.avatarAsset} />
                  <div>
                    <span>
                      <strong>{thread.title}</strong>
                      {thread.notificationMode === 'NONE' && (
                        <BellOff size={13} aria-label="Сповіщення вимкнено" />
                      )}
                    </span>
                    <p>{thread.lastMessage || 'Новий діалог'}</p>
                    <small>
                      {thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : 'Ще без повідомлень'}
                    </small>
                  </div>
                  {thread.unread && <i aria-label="Непрочитане" />}
                </Link>
              ))}
            </nav>
          ) : (
            <div className="messages-sidebar__empty">
              <MessageCircle size={24} />
              <strong>{search ? 'Нічого не знайдено' : unreadOnly ? 'Усе прочитано' : 'Діалогів ще немає'}</strong>
              <p>
                {search
                  ? 'Спробуйте коротший запит.'
                  : unreadOnly
                    ? 'Нові повідомлення з’являться тут.'
                    : 'Почніть приватну або групову розмову.'}
              </p>
            </div>
          )}
        </aside>
        <section aria-label="Поточний діалог">
          {!threadId ? (
            <EmptyState
              title="Оберіть діалог"
              description="Повідомлення, відповіді та налаштування з’являться тут."
            />
          ) : detail.isLoading ? (
            <Skeleton />
          ) : detail.isError || !detail.data ? (
            <ErrorState />
          ) : (
            <>
              <header>
                <Link
                  className="messages-back"
                  to={`/messages?${params.toString()}`}
                  aria-label="Назад до списку діалогів"
                >
                  <ArrowLeft size={18} />
                </Link>
                <div className="messages-thread-heading">
                  <h2>{detail.data.title}</h2>
                  <span>
                    <UsersRound size={14} />
                    {detail.data.participants.length} учасн.
                  </span>
                  <span className={`chat-live-status ${realtimeConnected ? 'is-live' : ''}`}>
                    {realtimeConnected ? 'Наживо' : 'Автооновлення'}
                  </span>
                </div>
                <div className="messages-thread-actions">
                  <Button
                    variant="ghost"
                    onClick={() => setParticipantsOpen(true)}
                    aria-label="Учасники діалогу"
                  >
                    <UsersRound size={17} />
                    <span>Учасники</span>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={preference.isPending || markRead.isPending}
                    onClick={() => preference.mutate({
                      notificationMode: detail.data!.notificationMode === 'NONE' ? 'ALL' : 'NONE',
                      expectedVersion: detail.data!.participantVersion,
                    })}
                    aria-label={detail.data.notificationMode === 'NONE'
                      ? 'Увімкнути сповіщення'
                      : 'Вимкнути сповіщення'}
                  >
                    {detail.data.notificationMode === 'NONE'
                      ? <BellOff size={17} />
                      : <BellRing size={17} />}
                    <span>{detail.data.notificationMode === 'NONE' ? 'Без звуку' : 'Сповіщення'}</span>
                  </Button>
                </div>
              </header>
              <div className="chat-stream">
                {detail.data.messages.length ? detail.data.messages.map((message) => {
                  const isOwn = message.authorId === user?.id
                  return (
                    <article className={isOwn ? 'is-own' : ''} key={message.id}>
                      {!isOwn && (
                        <Avatar
                          size="sm"
                          name={message.author.displayName}
                          src={message.author.avatarAsset}
                        />
                      )}
                      <div>
                        <strong>{message.author.displayName}</strong>
                        {message.replyPreview && (
                          <button
                            type="button"
                            className="chat-reply-preview"
                            onClick={() => document.getElementById(`message-${message.replyPreview!.id}`)?.focus()}
                          >
                            <span>{message.replyPreview.authorName}</span>
                            {message.replyPreview.body}
                          </button>
                        )}
                        {editingMessageId === message.id ? (
                          <form
                            className="chat-message-edit"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const text = editBody.trim()
                              if (!text || text === message.body) {
                                setEditingMessageId(null)
                                return
                              }
                              editMessage.mutate({
                                id: message.id,
                                body: text,
                                expectedVersion: message.version,
                              })
                            }}
                          >
                            <label>
                              <span className="sr-only">Змінити повідомлення</span>
                              <textarea
                                autoFocus
                                rows={3}
                                maxLength={8000}
                                value={editBody}
                                onChange={(event) => setEditBody(event.target.value)}
                              />
                            </label>
                            <div>
                              <button
                                type="button"
                                disabled={editMessage.isPending}
                                onClick={() => setEditingMessageId(null)}
                              >
                                Скасувати
                              </button>
                              <button
                                type="submit"
                                disabled={editMessage.isPending || !editBody.trim()}
                              >
                                Зберегти
                              </button>
                            </div>
                            {editMessage.isError && (
                              <small role="alert">Повідомлення вже могло змінитися. Оновіть діалог.</small>
                            )}
                          </form>
                        ) : message.deletedAt ? (
                          <p
                            className="chat-message-deleted"
                            id={`message-${message.id}`}
                            tabIndex={-1}
                          >
                            Повідомлення видалено
                          </p>
                        ) : (
                          <p id={`message-${message.id}`} tabIndex={-1}>{message.body}</p>
                        )}
                        {!message.deletedAt && message.attachments.length > 0 && (
                          <div className="chat-message-attachments">
                            {message.attachments.map((attachment) => attachment.scanStatus === 'CLEAN' ? (
                              <a
                                href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}
                                key={attachment.id}
                              >
                                <FileText size={15} />
                                <span>
                                  <strong>{attachment.fileName}</strong>
                                  <small>{formatChatBytes(attachment.bytes)}</small>
                                </span>
                              </a>
                            ) : (
                              <span key={attachment.id}>
                                <LoaderCircle size={15} aria-hidden />
                                <span>
                                  <strong>{attachment.fileName}</strong>
                                  <small>{chatAttachmentStatusLabel(attachment.scanStatus)}</small>
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                        {deletingMessageId === message.id && (
                          <div className="chat-message-delete-confirm" role="alert">
                            <span>Видалити повідомлення?</span>
                            <button
                              type="button"
                              disabled={deleteMessage.isPending}
                              onClick={() => setDeletingMessageId(null)}
                            >
                              Ні
                            </button>
                            <button
                              type="button"
                              disabled={deleteMessage.isPending}
                              onClick={() => deleteMessage.mutate({
                                id: message.id,
                                expectedVersion: message.version,
                              })}
                            >
                              Видалити
                            </button>
                          </div>
                        )}
                        <footer>
                          <small>
                            {formatDateTime(message.createdAt)}
                            {message.editedAt && !message.deletedAt ? ' · ред.' : ''}
                          </small>
                          {!message.deletedAt && !message.replyToId && detail.data!.canPost && (
                            <button type="button" onClick={() => setReplyTo(message)}>
                              <Reply size={13} />
                              Відповісти
                            </button>
                          )}
                          {!message.deletedAt && (
                            message.canEdit
                            || message.canDelete
                            || canConvertToTask
                            || canConvertToEvent
                          ) && (
                            <details className="chat-message-menu">
                              <summary aria-label="Дії з повідомленням">
                                <MoreHorizontal size={15} />
                              </summary>
                              <div>
                                {canConvertToTask && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      setConversion({ kind: 'task', message })
                                      event.currentTarget.closest('details')?.removeAttribute('open')
                                    }}
                                  >
                                    <ListTodo size={14} />
                                    Створити завдання
                                  </button>
                                )}
                                {canConvertToEvent && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      setConversion({ kind: 'event', message })
                                      event.currentTarget.closest('details')?.removeAttribute('open')
                                    }}
                                  >
                                    <CalendarPlus size={14} />
                                    Додати в календар
                                  </button>
                                )}
                                {message.canEdit && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      setEditingMessageId(message.id)
                                      setEditBody(message.body)
                                      setDeletingMessageId(null)
                                      event.currentTarget.closest('details')?.removeAttribute('open')
                                    }}
                                  >
                                    <Pencil size={14} />
                                    Редагувати
                                  </button>
                                )}
                                {message.canDelete && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      setDeletingMessageId(message.id)
                                      setEditingMessageId(null)
                                      event.currentTarget.closest('details')?.removeAttribute('open')
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    Видалити
                                  </button>
                                )}
                              </div>
                            </details>
                          )}
                        </footer>
                        {deleteMessage.isError && deletingMessageId === message.id && (
                          <small role="alert">Не вдалося видалити. Оновіть діалог і спробуйте ще раз.</small>
                        )}
                      </div>
                    </article>
                  )
                }) : (
                  <div className="chat-empty">
                    <MessageCircle size={25} />
                    <strong>Почніть розмову</strong>
                    <p>Перше повідомлення одразу побачать учасники діалогу.</p>
                  </div>
                )}
                <div ref={streamEndRef} />
              </div>
              {detail.data.canPost && (
                <form
                  className="chat-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const text = body.trim()
                    if (!text) return
                    const replyToId = replyTo?.id ?? null
                    const attachmentIds = attachments.map((attachment) => attachment.id)
                    const signature = JSON.stringify({ threadId, text, replyToId, attachmentIds })
                    if (sendAttemptRef.current.signature !== signature) {
                      sendAttemptRef.current = {
                        signature,
                        key: idempotencyKey('chat-message'),
                      }
                    }
                    send.mutate({
                      text,
                      replyToId,
                      attachmentIds,
                      key: sendAttemptRef.current.key,
                    })
                  }}
                >
                  {replyTo && (
                    <div className="chat-form__reply">
                      <Reply size={14} />
                      <span>
                        <strong>Відповідь для {replyTo.author.displayName}</strong>
                        <small>{replyTo.body}</small>
                      </span>
                      <button type="button" aria-label="Скасувати відповідь" onClick={() => setReplyTo(null)}>
                        <X size={15} />
                      </button>
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <div className="chat-form__attachments" aria-label="Вкладення повідомлення">
                      {attachments.map((attachment) => (
                        <span key={attachment.id}>
                          <FileText size={15} />
                          <span>
                            <strong>{attachment.fileName}</strong>
                            <small>
                              {formatChatBytes(attachment.bytes)} · перевіряється
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Прибрати ${attachment.fileName}`}
                            onClick={() => setAttachments((current) =>
                              current.filter((item) => item.id !== attachment.id),
                            )}
                          >
                            <X size={15} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    ref={attachmentInputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    aria-label="Файли для повідомлення"
                    accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.txt"
                    onChange={(event) => {
                      const remaining = 5 - attachments.length
                      const files = [...(event.target.files ?? [])].slice(0, remaining)
                      event.target.value = ''
                      setUploadError('')
                      if (files.length) upload.mutate(files)
                    }}
                  />
                  <button
                    className="chat-form__attach"
                    type="button"
                    aria-label="Додати вкладення"
                    disabled={upload.isPending || attachments.length >= 5}
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    {upload.isPending
                      ? <LoaderCircle className="is-spinning" size={18} />
                      : <Paperclip size={18} />}
                  </button>
                  <label>
                    <span className="sr-only">Повідомлення</span>
                    <textarea
                      rows={2}
                      value={body}
                      maxLength={8000}
                      onChange={(event) => setBody(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          event.currentTarget.form?.requestSubmit()
                        }
                      }}
                      placeholder={replyTo ? 'Написати відповідь' : 'Написати повідомлення'}
                    />
                  </label>
                  <Button
                    aria-label="Надіслати повідомлення"
                    disabled={send.isPending || upload.isPending || !body.trim()}
                  >
                    <Send size={18} />
                  </Button>
                  {(send.isError || uploadError) && (
                    <p role="alert">
                      {uploadError || 'Не вдалося надіслати. Текст збережено — спробуйте ще раз.'}
                    </p>
                  )}
                </form>
              )}
            </>
          )}
        </section>
      </Card>
      {isCreating && (
        <NewThreadDrawer
          initialCompanyId={companyId}
          initialParticipantId={params.get('to') ?? undefined}
          onClose={() => setParams((current) => {
            current.delete('new')
            current.delete('to')
            return current
          }, { replace: true })}
          onCreated={(id, selectedCompanyId) => {
            const next = new URLSearchParams(params)
            next.delete('new')
            next.delete('to')
            next.set('company', selectedCompanyId)
            navigate(`/messages/${id}?${next.toString()}`)
          }}
        />
      )}
      {participantsOpen && detail.data && (
        <ChatParticipantsDrawer
          thread={detail.data}
          onClose={() => setParticipantsOpen(false)}
          onLeft={() => {
            setParticipantsOpen(false)
            navigate(`/messages?${params.toString()}`)
          }}
        />
      )}
      {conversion && detail.data && (
        <MessageConversionDrawer
          key={`${conversion.kind}:${conversion.message.id}`}
          kind={conversion.kind}
          message={conversion.message}
          companyId={detail.data.companyId}
          onClose={() => setConversion(null)}
        />
      )}
    </div>
  )
}

function MessageConversionDrawer({
  kind,
  message,
  companyId,
  onClose,
}: {
  kind: 'task' | 'event'
  message: ChatMessageView
  companyId: string
  onClose: () => void
}) {
  const { user } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resultId, setResultId] = useState('')
  const attemptRef = useRef({ signature: '', key: '' })
  const eventWindow = useRef(nextChatEventWindow())
  const employees = useQuery({
    queryKey: ['chat-conversion-employees', companyId],
    queryFn: () => api<{ items: ChatEmployee[] }>(
      `/employees?company=${encodeURIComponent(companyId)}`,
    ),
    enabled: kind === 'task',
  })
  const suggestedTitle = message.body.replace(/\s+/g, ' ').trim().slice(0, 180)
  const resultHref = kind === 'task'
    ? `/tasks/${resultId}`
    : `/calendar/events/${resultId}?company=${encodeURIComponent(companyId)}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = kind === 'task'
      ? {
          title: String(form.get('title') ?? ''),
          assigneeId: String(form.get('assigneeId') ?? ''),
          ...(form.get('deadline')
            ? { deadline: new Date(String(form.get('deadline'))).toISOString() }
            : {}),
        }
      : {
          title: String(form.get('title') ?? ''),
          startAt: new Date(String(form.get('startAt'))).toISOString(),
          endAt: new Date(String(form.get('endAt'))).toISOString(),
          sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv',
          allDay: form.get('allDay') === 'on',
        }
    const signature = JSON.stringify(payload)
    if (attemptRef.current.signature !== signature) {
      attemptRef.current = {
        signature,
        key: idempotencyKey(`chat-${kind}`),
      }
    }
    setBusy(true)
    setError('')
    try {
      const result = await api<{ id: string }>(`/messages/${message.id}/${kind}`, {
        method: 'POST',
        headers: { 'idempotency-key': attemptRef.current.key },
        body: jsonBody(payload),
      })
      setResultId(result.id)
    } catch {
      setError(kind === 'task'
        ? 'Не вдалося створити завдання. Перевірте виконавця та строк.'
        : 'Не вдалося додати подію. Перевірте час початку й завершення.')
    } finally {
      setBusy(false)
    }
  }

  if (resultId) {
    return (
      <Drawer title={kind === 'task' ? 'Завдання створено' : 'Подію додано'} onClose={onClose}>
        <div className="chat-conversion-success">
          <span><CheckCircle2 size={24} /></span>
          <h3>{kind === 'task' ? 'Контекст уже прикріплено' : 'Подія вже у вашому календарі'}</h3>
          <p>
            Вихідне повідомлення збережено як пов’язаний контекст — копіювати текст вручну не потрібно.
          </p>
          <Link className="button button--primary" to={resultHref}>
            {kind === 'task' ? <ListTodo size={17} /> : <CalendarPlus size={17} />}
            {kind === 'task' ? 'Відкрити завдання' : 'Відкрити подію'}
          </Link>
          <Button variant="secondary" onClick={onClose}>Повернутися до діалогу</Button>
        </div>
      </Drawer>
    )
  }

  return (
    <Drawer
      title={kind === 'task' ? 'Створити завдання' : 'Додати в календар'}
      onClose={onClose}
    >
      <form className="chat-conversion" onSubmit={submit}>
        <div className="chat-conversion__source">
          <MessageCircle size={16} />
          <span>
            <strong>Повідомлення від {message.author.displayName}</strong>
            <small>{message.body}</small>
          </span>
        </div>
        <label>
          Назва
          <input
            name="title"
            required
            minLength={2}
            maxLength={180}
            defaultValue={suggestedTitle}
            autoFocus
          />
        </label>
        {kind === 'task' ? (
          <>
            <label>
              Виконавець
              <select
                name="assigneeId"
                required
                defaultValue={user?.id ?? ''}
                disabled={employees.isLoading}
              >
                {user && (
                  <option value={user.id}>{user.displayName} · я</option>
                )}
                {employees.data?.items
                  .filter((employee) => employee.id !== user?.id)
                  .map((employee) => (
                    <option value={employee.id} key={employee.id}>
                      {employee.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Строк <span className="optional">необов’язково</span>
              <input type="datetime-local" name="deadline" />
            </label>
          </>
        ) : (
          <>
            <div className="chat-conversion__dates">
              <label>
                Початок
                <input
                  type="datetime-local"
                  name="startAt"
                  required
                  defaultValue={eventWindow.current.start}
                />
              </label>
              <label>
                Завершення
                <input
                  type="datetime-local"
                  name="endAt"
                  required
                  defaultValue={eventWindow.current.end}
                />
              </label>
            </div>
            <label className="check-label">
              <input type="checkbox" name="allDay" />
              Подія на весь день
            </label>
          </>
        )}
        <p className="chat-conversion__hint">
          {kind === 'task'
            ? 'Повідомлення стане джерелом завдання, а його текст — початковим описом.'
            : 'Подію буде видно у внутрішньому календарі організації.'}
        </p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>Скасувати</Button>
          <Button disabled={busy || (kind === 'task' && employees.isLoading)}>
            {kind === 'task' ? <ListTodo size={17} /> : <CalendarPlus size={17} />}
            {busy
              ? 'Створюємо…'
              : kind === 'task' ? 'Створити завдання' : 'Додати подію'}
          </Button>
        </div>
      </form>
    </Drawer>
  )
}

function ChatParticipantsDrawer({
  thread,
  onClose,
  onLeft,
}: {
  thread: ChatThreadDetail
  onClose: () => void
  onLeft: () => void
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const addAttemptRef = useRef({ userId: '', key: '' })
  const employees = useQuery({
    queryKey: ['chat-participant-employees', thread.companyId, search],
    queryFn: () => api<{ items: ChatEmployee[] }>(
      `/employees?company=${encodeURIComponent(thread.companyId)}&search=${encodeURIComponent(search)}`,
    ),
    enabled: thread.canManageParticipants,
  })
  const refreshThread = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['thread', thread.id] }),
      client.invalidateQueries({ queryKey: ['threads'] }),
    ])
  }
  const addParticipant = useMutation({
    mutationFn: (userId: string) => {
      if (addAttemptRef.current.userId !== userId) {
        addAttemptRef.current = {
          userId,
          key: idempotencyKey('chat-participant'),
        }
      }
      return api(`/messages/threads/${thread.id}/participants`, {
        method: 'POST',
        headers: { 'idempotency-key': addAttemptRef.current.key },
        body: jsonBody({
          userId,
          role: 'MEMBER',
          expectedThreadVersion: thread.version,
        }),
      })
    },
    onSuccess: async () => {
      setSearch('')
      setError('')
      addAttemptRef.current = { userId: '', key: '' }
      await refreshThread()
    },
    onError: () => setError('Склад діалогу вже міг змінитися. Оновіть і спробуйте ще раз.'),
  })
  const updateParticipant = useMutation({
    mutationFn: (input: { participant: ChatParticipantView; role: 'OWNER' | 'MEMBER' }) =>
      api(`/messages/threads/${thread.id}/participants/${input.participant.id}`, {
        method: 'PUT',
        body: jsonBody({
          role: input.role,
          expectedVersion: input.participant.version,
          expectedThreadVersion: thread.version,
        }),
      }),
    onSuccess: async () => {
      setError('')
      await refreshThread()
    },
    onError: () => setError('Спочатку призначте іншого власника або оновіть склад діалогу.'),
  })
  const removeParticipant = useMutation({
    mutationFn: (participant: ChatParticipantView) =>
      api(`/messages/threads/${thread.id}/participants/${participant.id}`, {
        method: 'DELETE',
        body: jsonBody({
          expectedVersion: participant.version,
          expectedThreadVersion: thread.version,
        }),
      }),
    onSuccess: async (_, participant) => {
      setError('')
      if (participant.id === user?.id) {
        onLeft()
        return
      }
      await refreshThread()
    },
    onError: () => setError('Не вдалося змінити склад. У діалозі має лишитися власник і достатньо учасників.'),
  })
  const pending = addParticipant.isPending || updateParticipant.isPending || removeParticipant.isPending
  const participantIds = new Set(thread.participants.map((participant) => participant.id))
  const availableEmployees = employees.data?.items.filter((employee) =>
    employee.id !== user?.id && !participantIds.has(employee.id),
  ) ?? []

  return (
    <Drawer
      title="Учасники діалогу"
      onClose={onClose}
      footer={thread.canLeave ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            const current = thread.participants.find((participant) => participant.id === user?.id)
            if (current) removeParticipant.mutate(current)
          }}
        >
          <LogOut size={16} />
          Вийти з діалогу
        </Button>
      ) : undefined}
    >
      <div className="chat-participants">
        <p>
          {thread.canManageParticipants
            ? 'Власники можуть додавати людей і керувати ролями.'
            : 'Склад діалогу доступний для перегляду.'}
        </p>
        <div className="chat-participants__list">
          {thread.participants.map((participant) => (
            <article key={participant.id}>
              <Avatar
                size="sm"
                name={participant.displayName}
                src={participant.avatarAsset}
              />
              <span>
                <strong>
                  {participant.displayName}
                  {participant.id === user?.id ? ' · ви' : ''}
                </strong>
                <small>
                  {participant.role === 'OWNER' ? (
                    <>
                      <Crown size={12} />
                      Власник
                    </>
                  ) : 'Учасник'}
                </small>
              </span>
              {thread.canManageParticipants && (
                <div>
                  <select
                    aria-label={`Роль: ${participant.displayName}`}
                    value={participant.role}
                    disabled={pending}
                    onChange={(event) => updateParticipant.mutate({
                      participant,
                      role: event.target.value as 'OWNER' | 'MEMBER',
                    })}
                  >
                    <option value="MEMBER">Учасник</option>
                    <option value="OWNER">Власник</option>
                  </select>
                  {participant.id !== user?.id && (
                    <button
                      type="button"
                      aria-label={`Прибрати ${participant.displayName}`}
                      disabled={pending}
                      onClick={() => removeParticipant.mutate(participant)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
        {thread.canManageParticipants && thread.participants.length < 50 && (
          <section className="chat-participants__add">
            <h3>
              <UserPlus size={17} />
              Додати учасника
            </h3>
            <label className="search-field">
              <span className="sr-only">Знайти працівника</span>
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ім’я або нікнейм"
              />
              {search && (
                <button type="button" aria-label="Очистити пошук" onClick={() => setSearch('')}>
                  <X size={15} />
                </button>
              )}
            </label>
            {employees.isLoading ? (
              <Skeleton rows={3} />
            ) : employees.isError ? (
              <ErrorState title="Не вдалося завантажити працівників" />
            ) : availableEmployees.length ? (
              <div className="chat-participants__results">
                {availableEmployees.map((employee) => (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => addParticipant.mutate(employee.id)}
                    key={employee.id}
                  >
                    <Avatar size="sm" name={employee.displayName} src={employee.avatarAsset} />
                    <span>
                      <strong>{employee.displayName}</strong>
                      <small>{employee.jobTitle}</small>
                    </span>
                    <Plus size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <small className="chat-participants__none">
                {search ? 'Нікого не знайдено.' : 'Усі доступні працівники вже в діалозі.'}
              </small>
            )}
          </section>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}

function NewThreadDrawer({
  initialCompanyId,
  initialParticipantId,
  onClose,
  onCreated,
}: {
  initialCompanyId: string
  initialParticipantId?: string
  onClose: () => void
  onCreated: (threadId: string, companyId: string) => void
}) {
  const { user } = useAuth()
  const companyId = user?.organization.id ?? initialCompanyId
  const [kind, setKind] = useState<'DIRECT' | 'GROUP'>('DIRECT')
  const [title, setTitle] = useState('')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialParticipantId && initialParticipantId !== user?.id ? [initialParticipantId] : [],
  )
  const createAttemptRef = useRef({ signature: '', key: '' })
  const employees = useQuery({
    queryKey: ['chat-employees', companyId, search],
    queryFn: () => api<{ items: ChatEmployee[] }>(
      `/employees?company=${encodeURIComponent(companyId)}&search=${encodeURIComponent(search)}`,
    ),
    enabled: Boolean(companyId),
  })
  const create = useMutation({
    mutationFn: () => {
      const payload = {
        companyId,
        kind,
        title: kind === 'GROUP' ? title : undefined,
        participantIds: selectedIds,
      }
      const signature = JSON.stringify(payload)
      if (createAttemptRef.current.signature !== signature) {
        createAttemptRef.current = {
          signature,
          key: idempotencyKey('chat-thread'),
        }
      }
      return api<{ id: string }>('/messages/threads', {
        method: 'POST',
        headers: { 'idempotency-key': createAttemptRef.current.key },
        body: jsonBody(payload),
      })
    },
    onSuccess: (result) => onCreated(result.id, companyId),
  })
  const requiredSelected = kind === 'DIRECT' ? 1 : 2

  function toggleParticipant(userId: string) {
    setSelectedIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId)
      if (kind === 'DIRECT') return [userId]
      return [...current, userId]
    })
  }

  return (
    <Drawer
      title="Новий діалог"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Скасувати</Button>
          <Button
            disabled={
              create.isPending
              || selectedIds.length < requiredSelected
              || (kind === 'GROUP' && title.trim().length < 2)
            }
            onClick={() => create.mutate()}
          >
            Створити діалог
          </Button>
        </>
      )}
    >
      <div className="new-thread">
        <p>Оберіть формат і людей. Доступ матимуть лише додані учасники.</p>
        <fieldset>
          <legend>Формат</legend>
          <label>
            <input
              type="radio"
              name="thread-kind"
              checked={kind === 'DIRECT'}
              onChange={() => {
                setKind('DIRECT')
                setSelectedIds((current) => current.slice(0, 1))
              }}
            />
            <span>
              <strong>Особистий</strong>
              <small>Розмова вдвох</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="thread-kind"
              checked={kind === 'GROUP'}
              onChange={() => setKind('GROUP')}
            />
            <span>
              <strong>Груповий</strong>
              <small>Від трьох учасників</small>
            </span>
          </label>
        </fieldset>
        {kind === 'GROUP' && (
          <label>
            Назва діалогу
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Наприклад, Запуск кабінету"
            />
          </label>
        )}
        <label className="search-field">
          <span className="sr-only">Знайти працівника</span>
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ім’я або нікнейм"
          />
        </label>
        <div className="new-thread__selection" aria-live="polite">
          Обрано {selectedIds.length} · потрібно щонайменше {requiredSelected}
        </div>
        {employees.isLoading ? (
          <Skeleton rows={5} />
        ) : employees.isError ? (
          <ErrorState title="Не вдалося завантажити працівників" />
        ) : (
          <div className="new-thread__people">
            {employees.data?.items
              .filter((employee) => employee.id !== user?.id)
              .map((employee) => {
                const selected = selectedIds.includes(employee.id)
                return (
                  <button
                    type="button"
                    className={selected ? 'is-selected' : ''}
                    onClick={() => toggleParticipant(employee.id)}
                    key={employee.id}
                    aria-pressed={selected}
                  >
                    <Avatar size="sm" name={employee.displayName} src={employee.avatarAsset} />
                    <span>
                      <strong>{employee.displayName}</strong>
                      <small>{employee.jobTitle}</small>
                    </span>
                    <i>{selected ? <Check size={15} /> : <Plus size={15} />}</i>
                  </button>
                )
              })}
          </div>
        )}
        {create.isError && (
          <p className="form-error" role="alert">
            Не вдалося створити діалог. Перевірте учасників і спробуйте ще раз.
          </p>
        )}
      </div>
    </Drawer>
  )
}

function formatChatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function nextChatEventWindow(): { start: string; end: string } {
  const start = new Date()
  start.setHours(start.getHours() + 1, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    start: localDatetimeInput(start),
    end: localDatetimeInput(end),
  }
}

function localDatetimeInput(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0')
  return [
    `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`,
    `${part(value.getHours())}:${part(value.getMinutes())}`,
  ].join('T')
}

function chatAttachmentStatusLabel(status: ChatAttachmentView['scanStatus']): string {
  if (status === 'QUARANTINED' || status === 'SCANNING') return 'Перевіряється'
  if (status === 'INFECTED') return 'Файл заблоковано'
  return 'Файл недоступний'
}
