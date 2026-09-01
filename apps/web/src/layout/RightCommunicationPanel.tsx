import type {
  ChatAttachmentView,
  ChatMessageView,
  ChatThreadListItem,
  StructuredMentionInput,
} from '@bert-crm/contracts'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowDown,
  Bell,
  BellRing,
  Building2,
  CheckCircle2,
  ChevronRight,
  FileText,
  ListTodo,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  PanelRightClose,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getMessagePage,
  getThreadDetail,
  getThreadPage,
  sendMessage,
  uploadMessageAttachment,
} from '../features/messages/api/messageApi'
import { messageKeys } from '../features/messages/api/messageKeys'
import { formatChatTime } from '../features/messages/lib/chatDates'
import { MessageComposer } from '../features/messages/components/MessageComposer'
import { usePreservedChatScroll } from '../features/messages/hooks/usePreservedChatScroll'
import '../features/messages/messages.css'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { Avatar, ErrorState, IconButton, Skeleton } from '../shared/ui'
import './right-communication-panel.css'

type PanelTab = 'chat' | 'notifications'
type ChatScreen = 'threads' | 'conversation' | 'profile'
type NotificationFilter = 'all' | 'unread' | 'mentions'

interface NotificationItem {
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

interface EmployeeProfile {
  id: string
  displayName: string
  jobTitle: string
  positionTitle?: string
  timezone: string
  avatarAsset: string | null
  contactEmail?: string | null
  orgUnit?: { id: string; name: string; parent: { id: string; name: string } | null } | null
  approver?: { id?: string; displayName: string } | null
}

interface RightCommunicationPanelProps {
  chatUnread: number
  notificationUnread: number
  onClose: () => void
}

const notificationLabels: Record<string, string> = {
  APPROVALS: 'Погодження',
  CHAT: 'Чат',
  DIRECT: 'Особисте',
  FEED: 'Стрічка',
  MENTION: 'Згадка',
  SECURITY: 'Безпека',
  TASKS: 'Завдання',
}

function notificationIcon(category: string) {
  if (category === 'TASKS') return <ListTodo size={18} />
  if (category === 'CHAT') return <MessageCircle size={18} />
  if (category === 'APPROVALS') return <CheckCircle2 size={18} />
  if (category === 'MENTION') return <BellRing size={18} />
  if (category === 'FEED') return <Megaphone size={18} />
  if (category === 'SECURITY') return <ShieldCheck size={18} />
  return <Bell size={18} />
}

function notificationRoute(item: NotificationItem) {
  if (!item.entityId) return null
  if (item.entityType === 'TASK') return `/tasks/${item.entityId}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}`
  if (item.entityType === 'FEED_POST') return item.requiresAction ? '/feed?filter=ACK_REQUIRED' : '/feed'
  if (item.entityType === 'USER') return '/settings/security'
  return null
}

function ThreadAvatar({ thread }: { thread: ChatThreadListItem }) {
  if (thread.kind === 'DIRECT') return <Avatar name={thread.title} src={thread.avatarAsset} />
  return (
    <span className="right-panel__group-avatar" aria-hidden="true">
      <UsersRound size={19} />
    </span>
  )
}

function RightPanelTabs({
  tab,
  chatUnread,
  notificationUnread,
  onChange,
  onClose,
}: {
  tab: PanelTab
  chatUnread: number
  notificationUnread: number
  onChange: (tab: PanelTab) => void
  onClose: () => void
}) {
  return (
    <header className="right-panel__topbar">
      <div className="right-panel__tabs" role="tablist" aria-label="Комунікації">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'is-active' : ''}
          onClick={() => onChange('chat')}
        >
          Чат
          {chatUnread > 0 && <b>{Math.min(chatUnread, 99)}</b>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notifications'}
          className={tab === 'notifications' ? 'is-active' : ''}
          onClick={() => onChange('notifications')}
        >
          Сповіщення
          {notificationUnread > 0 && <b>{Math.min(notificationUnread, 99)}</b>}
        </button>
      </div>
      <IconButton className="right-panel__toggle" label="Закрити праву панель" onClick={onClose}>
        <PanelRightClose size={19} />
      </IconButton>
    </header>
  )
}

export function RightCommunicationPanel(props: RightCommunicationPanelProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [tab, setTab] = useState<PanelTab>(() => {
    try {
      return window.localStorage.getItem('bertcrm.right-panel.tab') === 'notifications'
        ? 'notifications'
        : 'chat'
    } catch {
      return 'chat'
    }
  })
  const [chatScreen, setChatScreen] = useState<ChatScreen>('threads')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('all')
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([])
  const [composerError, setComposerError] = useState('')
  const markedReadRef = useRef('')

  useEffect(() => {
    try {
      window.localStorage.setItem('bertcrm.right-panel.tab', tab)
    } catch {
      // The current in-memory selection remains available when storage is blocked.
    }
  }, [tab])

  const threadPages = useInfiniteQuery({
    queryKey: messageKeys.threads('all', false),
    queryFn: ({ pageParam, signal }) => getThreadPage('all', false, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: tab === 'chat',
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const threads = threadPages.data?.pages.flatMap((page) => page.items) ?? []
  const selectedPreview = threads.find((thread) => thread.id === selectedThreadId)

  const detail = useQuery({
    queryKey: messageKeys.detail(selectedThreadId ?? ''),
    queryFn: ({ signal }) => getThreadDetail(selectedThreadId!, signal),
    enabled: tab === 'chat' && Boolean(selectedThreadId),
  })
  const messagePages = useInfiniteQuery({
    queryKey: messageKeys.pages(selectedThreadId ?? ''),
    queryFn: ({ pageParam, signal }) => getMessagePage(
      selectedThreadId!,
      pageParam ? { before: pageParam } : {},
      signal,
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.olderCursor ?? undefined,
    enabled: tab === 'chat' && Boolean(selectedThreadId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const messages = useMemo(
    () => messagePages.data?.pages.slice().reverse().flatMap((page) => page.items) ?? [],
    [messagePages.data],
  )
  const directParticipant = detail.data?.kind === 'DIRECT'
    ? detail.data.participants.find((participant) => participant.id !== user?.id)
    : null

  const profile = useQuery({
    queryKey: ['employee', directParticipant?.id],
    queryFn: () => api<EmployeeProfile>(`/employees/${directParticipant!.id}`),
    enabled: chatScreen === 'profile' && Boolean(directParticipant?.id),
  })

  const send = useMutation({
    mutationFn: (input: { body: string; mentions: StructuredMentionInput[] }) => sendMessage(
      selectedThreadId!,
      {
        body: input.body,
        mentions: input.mentions,
        attachmentIds: attachments.map((attachment) => attachment.id),
      },
      idempotencyKey('right-panel-message'),
    ),
    onSuccess: async () => {
      setAttachments([])
      setComposerError('')
      await Promise.all([
        client.invalidateQueries({ queryKey: messageKeys.pages(selectedThreadId!) }),
        client.invalidateQueries({ queryKey: messageKeys.detail(selectedThreadId!) }),
        client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
        client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
      ])
    },
    onError: () => setComposerError('Не вдалося надіслати. Текст збережено, можна повторити.'),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded = await Promise.all(
        files.slice(0, 5 - attachments.length).map((file) => uploadMessageAttachment(selectedThreadId!, file)),
      )
      return uploaded
    },
    onSuccess: (uploaded) => {
      setAttachments((current) => [...current, ...uploaded].slice(0, 5))
      setComposerError('')
    },
    onError: () => setComposerError('Не вдалося додати файл.'),
  })
  const markThreadRead = useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) => api(
      `/messages/threads/${threadId}/read`,
      { method: 'POST', body: jsonBody({ lastReadMessageId: messageId }) },
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
      void client.invalidateQueries({ queryKey: ['threads', 'summary'] })
      void client.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: () => { markedReadRef.current = '' },
  })

  useEffect(() => {
    const lastMessageId = detail.data?.lastMessageId
    const marker = selectedThreadId && lastMessageId ? `${selectedThreadId}:${lastMessageId}` : ''
    if (!marker || markedReadRef.current === marker || chatScreen !== 'conversation') return
    markedReadRef.current = marker
    markThreadRead.mutate({ threadId: selectedThreadId!, messageId: lastMessageId! })
  }, [chatScreen, detail.data?.lastMessageId, selectedThreadId])

  const notifications = useQuery({
    queryKey: ['notifications', notificationFilter],
    queryFn: () => api<{
      items: NotificationItem[]
      counts: { action: number; unread: number }
    }>(`/notifications?tab=${notificationFilter}`),
    enabled: tab === 'notifications',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const markNotification = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api(`/notifications/${id}`, {
      method: 'PATCH',
      body: jsonBody({ read }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAllNotifications = useMutation({
    mutationFn: () => api('/notifications/read-all', {
      method: 'PATCH',
      body: jsonBody({ tab: notificationFilter }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId)
    setChatScreen('conversation')
    setAttachments([])
    setComposerError('')
  }

  function openNotification(item: NotificationItem) {
    if (!item.readAt) markNotification.mutate({ id: item.id, read: true })
    if (item.entityType === 'MESSAGE_THREAD' && item.entityId) {
      setTab('chat')
      selectThread(item.entityId)
      return
    }
    const route = notificationRoute(item)
    if (route) navigate(route)
  }

  return (
    <aside className="right-panel" aria-label="Чат і сповіщення">
      <RightPanelTabs
        tab={tab}
        chatUnread={props.chatUnread}
        notificationUnread={props.notificationUnread}
        onChange={(nextTab) => {
          setTab(nextTab)
          if (nextTab === 'chat' && !selectedThreadId) setChatScreen('threads')
        }}
        onClose={props.onClose}
      />

      {tab === 'chat' && chatScreen === 'threads' && (
        <section className="right-panel__screen right-panel__threads" aria-label="Діалоги">
          <div className="right-panel__screen-heading">
            <div><h2>Чат</h2><p>Останні робочі діалоги</p></div>
            <Link to="/messages?new=1" onClick={props.onClose}>Новий чат</Link>
          </div>
          {threadPages.isLoading ? <Skeleton rows={7} /> : threadPages.isError ? (
            <ErrorState title="Не вдалося завантажити діалоги" onRetry={() => void threadPages.refetch()} />
          ) : threads.length ? (
            <div className="right-panel__thread-list">
              {threads.map((thread) => (
                <button
                  type="button"
                  key={thread.id}
                  className={thread.unread ? 'is-unread' : ''}
                  onClick={() => selectThread(thread.id)}
                >
                  <ThreadAvatar thread={thread} />
                  <span>
                    <span><strong>{thread.title}</strong><time>{thread.lastMessageAt ? formatChatTime(thread.lastMessageAt) : ''}</time></span>
                    <span><small>{thread.lastMessage || 'Почніть розмову'}</small>{thread.unreadCount > 0 && <b>{Math.min(thread.unreadCount, 99)}</b>}</span>
                  </span>
                </button>
              ))}
              {threadPages.hasNextPage && (
                <button
                  type="button"
                  className="right-panel__load-more"
                  disabled={threadPages.isFetchingNextPage}
                  onClick={() => void threadPages.fetchNextPage()}
                >
                  {threadPages.isFetchingNextPage ? 'Завантажуємо…' : 'Показати більше'}
                </button>
              )}
            </div>
          ) : (
            <div className="right-panel__empty"><MessageCircle size={28} /><strong>Діалогів ще немає</strong><Link to="/messages?new=1" onClick={props.onClose}>Почати розмову</Link></div>
          )}
        </section>
      )}

      {tab === 'chat' && chatScreen === 'conversation' && (
        <section className="right-panel__screen right-panel__conversation" aria-label={`Діалог: ${detail.data?.title ?? selectedPreview?.title ?? ''}`}>
          <header className="right-panel__conversation-header">
            <IconButton label="До списку діалогів" onClick={() => setChatScreen('threads')}><ArrowLeft size={19} /></IconButton>
            <button
              type="button"
              className="right-panel__person-trigger"
              disabled={!directParticipant}
              onClick={() => directParticipant && setChatScreen('profile')}
            >
              <Avatar name={detail.data?.title ?? selectedPreview?.title ?? ''} src={directParticipant?.avatarAsset ?? selectedPreview?.avatarAsset} />
              <span><strong>{detail.data?.title ?? selectedPreview?.title}</strong><small>{directParticipant ? `@${directParticipant.username}` : `${detail.data?.participants.length ?? 0} учасників`}</small></span>
              {directParticipant && <ChevronRight size={17} />}
            </button>
          </header>
          {detail.isLoading || messagePages.isLoading ? <div className="right-panel__loading"><Skeleton rows={8} /></div> : detail.isError || messagePages.isError || !detail.data ? (
            <ErrorState title="Не вдалося відкрити діалог" onRetry={() => { void detail.refetch(); void messagePages.refetch() }} />
          ) : (
            <>
              <PanelMessageStream
                key={selectedThreadId}
                messages={messages}
                currentUserId={user?.id ?? ''}
                canLoadOlder={Boolean(messagePages.hasNextPage)}
                loadingOlder={messagePages.isFetchingNextPage}
                onLoadOlder={() => messagePages.fetchNextPage()}
              />
              {detail.data.canPost && (
                <MessageComposer
                  key={detail.data.id}
                  threadId={detail.data.id}
                  replyTo={null}
                  attachments={attachments}
                  sending={send.isPending}
                  uploading={upload.isPending}
                  error={composerError}
                  onReplyCancel={() => {}}
                  onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                  onFiles={(files) => upload.mutate(files)}
                  onSend={async (input) => {
                    try {
                      await send.mutateAsync(input)
                      return true
                    } catch {
                      return false
                    }
                  }}
                />
              )}
            </>
          )}
        </section>
      )}

      {tab === 'chat' && chatScreen === 'profile' && (
        <section className="right-panel__screen right-panel__profile" aria-label="Інформація про користувача">
          <header className="right-panel__profile-header">
            <IconButton label="Повернутися до чату" onClick={() => setChatScreen('conversation')}><ArrowLeft size={19} /></IconButton>
            <h2>Інформація про користувача</h2>
          </header>
          {profile.isLoading ? <Skeleton rows={7} /> : profile.isError || !profile.data ? (
            <ErrorState title="Не вдалося завантажити профіль" onRetry={() => void profile.refetch()} />
          ) : <ProfileContent profile={profile.data} />}
        </section>
      )}

      {tab === 'notifications' && (
        <section className="right-panel__screen right-panel__notifications" aria-label="Сповіщення">
          <div className="right-panel__screen-heading">
            <div><h2>Сповіщення</h2><p>Робочі оновлення та важливі дії</p></div>
            {Boolean(notifications.data?.items.some((item) => !item.readAt)) && (
              <button type="button" disabled={markAllNotifications.isPending} onClick={() => markAllNotifications.mutate()}>Прочитати всі</button>
            )}
          </div>
          <div className="right-panel__filters" role="tablist" aria-label="Фільтр сповіщень">
            {([
              ['all', 'Усі'],
              ['unread', 'Непрочитані'],
              ['mentions', 'Згадки'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={notificationFilter === value} className={notificationFilter === value ? 'is-active' : ''} onClick={() => setNotificationFilter(value)}>{label}</button>
            ))}
          </div>
          {notifications.isLoading ? <Skeleton rows={7} /> : notifications.isError ? (
            <ErrorState title="Не вдалося завантажити сповіщення" onRetry={() => void notifications.refetch()} />
          ) : notifications.data?.items.length ? (
            <div className="right-panel__notification-list">
              {notifications.data.items.map((item) => (
                <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                  <span className={`right-panel__notification-icon right-panel__notification-icon--${item.category.toLowerCase()}`}>{notificationIcon(item.category)}</span>
                  <button type="button" onClick={() => openNotification(item)}>
                    <span><strong>{item.safeTitle}</strong>{item.requiresAction && <em>Потрібна дія</em>}</span>
                    <p>{item.safeSnippet}</p>
                    <small>{notificationLabels[item.category] ?? 'Оновлення'} · {formatDateTime(item.createdAt)}</small>
                  </button>
                  <button
                    type="button"
                    className="right-panel__read-toggle"
                    aria-label={item.readAt ? 'Позначити непрочитаним' : 'Позначити прочитаним'}
                    onClick={() => markNotification.mutate({ id: item.id, read: !item.readAt })}
                  ><span /></button>
                </article>
              ))}
            </div>
          ) : <div className="right-panel__empty"><Bell size={28} /><strong>Нових сповіщень немає</strong></div>}
          <Link className="right-panel__footer-link" to="/notifications" onClick={props.onClose}>Усі сповіщення <ChevronRight size={16} /></Link>
        </section>
      )}
    </aside>
  )
}

function PanelMessageStream({
  messages,
  currentUserId,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
}: {
  messages: ChatMessageView[]
  currentUserId: string
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<unknown>
}) {
  const [showBottom, setShowBottom] = useState(false)
  const loadingRequestedRef = useRef(false)
  const scroll = usePreservedChatScroll(messages.length)

  useEffect(() => {
    if (!loadingOlder) loadingRequestedRef.current = false
  }, [loadingOlder])

  function loadOlder() {
    if (!canLoadOlder || loadingOlder || loadingRequestedRef.current) return
    loadingRequestedRef.current = true
    scroll.rememberBeforePrepend()
    void onLoadOlder().catch(() => {
      loadingRequestedRef.current = false
    })
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = scroll.containerRef.current
      if (element && element.scrollHeight <= element.clientHeight + 1) loadOlder()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canLoadOlder, loadingOlder, messages.length])

  return (
    <div className="right-panel__message-stage">
      <div
        ref={scroll.containerRef}
        className="right-panel__messages"
        aria-live="polite"
        onScroll={() => {
          scroll.onScroll()
          const element = scroll.containerRef.current
          if (!element) return
          setShowBottom(element.scrollHeight - element.scrollTop - element.clientHeight > 180)
          if (element.scrollTop <= 72) loadOlder()
        }}
      >
        {loadingOlder && (
          <div className="right-panel__messages-loader" role="status">
            <LoaderCircle className="is-spinning" size={15} />
            Завантажуємо попередні повідомлення…
          </div>
        )}
        {messages.length ? messages.map((message) => (
          <CompactMessage key={message.id} message={message} own={message.authorId === currentUserId} />
        )) : <div className="right-panel__empty"><MessageCircle size={28} /><strong>Почніть розмову</strong></div>}
      </div>
      {showBottom && (
        <IconButton
          className="right-panel__messages-bottom"
          label="До нових повідомлень"
          onClick={() => scroll.scrollToBottom()}
        >
          <ArrowDown size={18} />
        </IconButton>
      )}
    </div>
  )
}

function CompactMessage({ message, own }: { message: ChatMessageView; own: boolean }) {
  return (
    <article className={`right-panel__message ${own ? 'is-own' : ''}`}>
      {!own && <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />}
      <div>
        {!own && <strong>{message.author.displayName}</strong>}
        {message.deletedAt ? <p className="is-deleted">Повідомлення видалено</p> : <p>{message.body}</p>}
        {message.attachments.map((attachment) => (
          <span className="right-panel__message-file" key={attachment.id}><FileText size={14} />{attachment.fileName}</span>
        ))}
        <time>{formatChatTime(message.createdAt)}{message.editedAt ? ' · змінено' : ''}</time>
      </div>
    </article>
  )
}

function ProfileContent({ profile }: { profile: EmployeeProfile }) {
  return (
    <div className="right-panel__profile-content">
      <div className="right-panel__profile-summary">
        <Avatar size="lg" name={profile.displayName} src={profile.avatarAsset} />
        <span><i aria-hidden="true" /></span>
        <h3>{profile.displayName}</h3>
        <p>{profile.positionTitle || profile.jobTitle}</p>
        <div>
          <Link className="button button--secondary" to={`/employees/${profile.id}`}><UserRound size={16} />Профіль</Link>
        </div>
      </div>
      <section>
        <h4>Контакти</h4>
        {profile.contactEmail ? <a href={`mailto:${profile.contactEmail}`}>{profile.contactEmail}</a> : <p>Контактний email не вказано</p>}
        <p>Часовий пояс · {profile.timezone}</p>
      </section>
      <section>
        <h4>Компанія</h4>
        {profile.orgUnit ? <p><Building2 size={15} />{profile.orgUnit.parent ? `${profile.orgUnit.parent.name} → ` : ''}{profile.orgUnit.name}</p> : <p>Підрозділ не вказано</p>}
        {profile.approver && <p>Керівник · {profile.approver.displayName}</p>}
      </section>
    </div>
  )
}
