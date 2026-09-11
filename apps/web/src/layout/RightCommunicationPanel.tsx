import type {
  ChatAttachmentView,
  ChatContactUser,
  ChatMessageView,
  ChatThreadListItem,
  StructuredMentionInput,
} from '@lankadws/contracts'
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
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  FileText,
  ListTodo,
  LoaderCircle,
  Mail,
  Megaphone,
  MessageCircle,
  Network,
  PanelRightClose,
  Paperclip,
  Phone,
  Send,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getMessagePage,
  getChatUser,
  getThreadDetail,
  getThreadPage,
  createThread,
  sendMessage,
  uploadMessageAttachment,
} from '../features/messages/api/messageApi'
import { messageKeys } from '../features/messages/api/messageKeys'
import { formatChatTime } from '../features/messages/lib/chatDates'
import { MessageComposer } from '../features/messages/components/MessageComposer'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { usePreservedChatScroll } from '../features/messages/hooks/usePreservedChatScroll'
import '../features/messages/messages.css'
import { api, apiUrl, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { Avatar, CompactFileName, ErrorState, IconButton, Skeleton } from '../shared/ui'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import './right-communication-panel.css'

type PanelTab = 'chat' | 'notifications'
type ChatScreen = 'threads' | 'conversation'
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
  username: string
  jobTitle: string
  positionTitle?: string
  primaryCompanyId: string | null
  primaryCompany?: { id: string; displayName: string } | null
  avatarAsset: string | null
  contactEmail?: string | null
  phone?: string | null
  orgUnit?: { id: string; name: string; parent: { id: string; name: string } | null } | null
  approver?: { id?: string; displayName: string } | null
  upcomingPresence?: Array<{ state: string; startAt: string; endAt: string }>
}

interface RightCommunicationPanelProps {
  chatUnread: number
  notificationUnread: number
  targetUserId: string | null
  onClearTarget: () => void
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

function formatPanelFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function isPreviewableImage(attachment: ChatAttachmentView): boolean {
  return attachment.scanStatus === 'CLEAN' && /^image\/(?:png|jpeg|gif|webp)$/.test(attachment.mimeType ?? '')
}

function panelAttachmentUrl(attachment: ChatAttachmentView): string {
  return apiUrl(`/files/${encodeURIComponent(attachment.id)}/download?inline=true`)
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
      return window.localStorage.getItem('lankadws.right-panel.tab') === 'notifications'
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
  const [profileSummaryOpen, setProfileSummaryOpen] = useState(false)
  const [chatFilesOpen, setChatFilesOpen] = useState(false)
  const markedReadRef = useRef('')
  const draftSendAttemptRef = useRef({
    signature: '',
    threadId: '',
    threadKey: '',
    messageKey: '',
    attachmentIds: [] as string[],
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('lankadws.right-panel.tab', tab)
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
  })
  const threads = useMemo(() => [
    ...new Map(
      (threadPages.data?.pages.flatMap((page) => page.items) ?? [])
        .map((thread) => [thread.id, thread]),
    ).values(),
  ], [threadPages.data])
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
  })
  const messages = useMemo(
    () => messagePages.data?.pages.slice().reverse().flatMap((page) => page.items) ?? [],
    [messagePages.data],
  )
  const sharedAttachments = useMemo(() => [
    ...new Map(
      messages.flatMap((message) => message.attachments).map((attachment) => [attachment.id, attachment]),
    ).values(),
  ].reverse(), [messages])
  const directParticipant = detail.data?.kind === 'DIRECT'
    ? detail.data.participants.find((participant) => participant.id !== user?.id)
    : null
  const profileUserId = props.targetUserId ?? directParticipant?.id
  const targetIsCurrentUser = Boolean(props.targetUserId && props.targetUserId === user?.id)
  const profile = useQuery({
    queryKey: ['employee', profileUserId],
    queryFn: () => api<EmployeeProfile>(`/employees/${encodeURIComponent(profileUserId!)}`),
    enabled: Boolean(profileUserId && (profileSummaryOpen || props.targetUserId)),
  })
  const targetContact = useQuery({
    queryKey: ['right-panel', 'target-contact', 'all', props.targetUserId],
    queryFn: ({ signal }) => getChatUser(
      'all',
      props.targetUserId!,
      signal,
    ),
    enabled: Boolean(
      props.targetUserId
      && !targetIsCurrentUser,
    ),
  })

  useEffect(() => {
    if (!props.targetUserId) return
    setTab('chat')
    setChatScreen('conversation')
    setSelectedThreadId(null)
    setProfileSummaryOpen(true)
    setChatFilesOpen(false)
    setAttachments([])
    setComposerError('')
    draftSendAttemptRef.current = {
      signature: '',
      threadId: '',
      threadKey: '',
      messageKey: '',
      attachmentIds: [],
    }
  }, [props.targetUserId])

  useEffect(() => {
    if (!props.targetUserId || !targetContact.data?.directThreadId) return
    setSelectedThreadId(targetContact.data.directThreadId)
  }, [props.targetUserId, targetContact.data?.directThreadId])

  const sendDraft = useMutation({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      const userId = props.targetUserId
      const companyId = user?.company?.id ?? profile.data?.primaryCompanyId
      if (!userId || !companyId) throw new Error('chat_target_unavailable')

      const signature = [
        userId,
        body,
        ...files.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      ].join('|')
      if (draftSendAttemptRef.current.signature !== signature) {
        draftSendAttemptRef.current = {
          signature,
          threadId: '',
          threadKey: idempotencyKey('right-panel-direct'),
          messageKey: idempotencyKey('right-panel-message'),
          attachmentIds: [],
        }
      }
      const attempt = draftSendAttemptRef.current
      if (!attempt.threadId) {
        const thread = await createThread({
          companyId,
          kind: 'DIRECT',
          participantIds: [userId],
        }, attempt.threadKey)
        attempt.threadId = thread.id
      }
      if (files.length && attempt.attachmentIds.length !== files.length) {
        const uploaded = await Promise.all(
          files.map((file) => uploadMessageAttachment(attempt.threadId, file)),
        )
        attempt.attachmentIds = uploaded.map((attachment) => attachment.id)
      }
      await sendMessage(attempt.threadId, {
        body,
        mentions: [],
        attachmentIds: attempt.attachmentIds,
      }, attempt.messageKey)
      return { threadId: attempt.threadId }
    },
    onSuccess: async ({ threadId }) => {
      setSelectedThreadId(threadId)
      setComposerError('')
      draftSendAttemptRef.current = {
        signature: '',
        threadId: '',
        threadKey: '',
        messageKey: '',
        attachmentIds: [],
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: messageKeys.pages(threadId) }),
        client.invalidateQueries({ queryKey: messageKeys.detail(threadId) }),
        client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
        client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
      ])
    },
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
    props.onClearTarget()
    setSelectedThreadId(threadId)
    setChatScreen('conversation')
    setProfileSummaryOpen(false)
    setChatFilesOpen(false)
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
        <section
          className="right-panel__screen right-panel__conversation"
          aria-label={targetIsCurrentUser
            ? `Профіль: ${profile.data?.displayName ?? ''}`
            : `Діалог: ${detail.data?.title ?? selectedPreview?.title ?? profile.data?.displayName ?? ''}`}
        >
          <div className={`right-panel__person-overview ${profileSummaryOpen ? 'is-open' : ''}`}>
            <header className="right-panel__conversation-header">
              <IconButton label="До списку діалогів" onClick={() => { props.onClearTarget(); setChatScreen('threads'); setProfileSummaryOpen(false) }}><ArrowLeft size={19} /></IconButton>
              <div className="right-panel__person-trigger">
                <Avatar
                  size="lg"
                  name={detail.data?.title ?? selectedPreview?.title ?? profile.data?.displayName ?? ''}
                  src={directParticipant?.avatarAsset ?? selectedPreview?.avatarAsset ?? profile.data?.avatarAsset}
                />
                <span>
                  <strong>{detail.data?.title ?? selectedPreview?.title ?? profile.data?.displayName ?? 'Відкриваємо чат…'}</strong>
                  <small>{directParticipant?.username ? `@${directParticipant.username}` : profile.data?.username ? `@${profile.data.username}` : ''}</small>
                </span>
              </div>
              {profileUserId && (
                <IconButton
                  className={`right-panel__profile-toggle ${profileSummaryOpen ? 'is-active' : ''}`}
                  label={profileSummaryOpen ? 'Згорнути інформацію про користувача' : 'Розгорнути інформацію про користувача'}
                  aria-expanded={profileSummaryOpen}
                  onClick={() => setProfileSummaryOpen((value) => {
                    const nextValue = !value
                    if (!nextValue) setChatFilesOpen(false)
                    return nextValue
                  })}
                >
                  <ChevronDown size={15} />
                </IconButton>
              )}
            </header>
            {profileSummaryOpen && (
              <CompactProfileSummary
                profile={profile.data}
                fallback={directParticipant ?? undefined}
                loading={profile.isLoading}
                error={profile.isError}
                onRetry={() => void profile.refetch()}
              />
            )}
          </div>
          {props.targetUserId && !selectedThreadId && (profile.isLoading || (!targetIsCurrentUser && targetContact.isLoading)) ? <div className="right-panel__loading"><Skeleton rows={8} /></div> : profile.isError && Boolean(props.targetUserId) || targetContact.isError ? (
            <ErrorState title="Не вдалося відкрити чат" onRetry={() => {
              void profile.refetch()
              void targetContact.refetch()
            }} />
          ) : targetIsCurrentUser && profile.data ? (
            <>
              <div className="right-panel__empty-spacer" aria-hidden="true" />
              <ConversationEmptyState
                title="Це ваш профіль"
                description="Контактна й робоча інформація доступна вище."
              />
            </>
          ) : props.targetUserId && !selectedThreadId && targetContact.data ? (
            <>
              <div className="right-panel__empty-spacer" aria-hidden="true" />
              <ConversationEmptyState
                title={`Почніть розмову з ${targetContact.data.displayName}`}
                description="Чат з’явиться у списку після першого повідомлення."
              />
              <DirectDraftComposer
                key={targetContact.data.id}
                contact={targetContact.data}
                sending={sendDraft.isPending}
                error={sendDraft.isError ? 'Не вдалося надіслати. Текст і файли збережено, можна повторити.' : ''}
                onEdit={() => sendDraft.reset()}
                onSend={async (input) => {
                  try {
                    await sendDraft.mutateAsync(input)
                    return true
                  } catch {
                    return false
                  }
                }}
              />
            </>
          ) : detail.isLoading || messagePages.isLoading ? <div className="right-panel__loading"><Skeleton rows={8} /></div> : detail.isError || messagePages.isError || !detail.data ? (
            <ErrorState title="Не вдалося відкрити діалог" onRetry={() => { void detail.refetch(); void messagePages.refetch() }} />
          ) : (
            <>
              {messages.length === 0 && <ConversationEmptyState title="Почніть розмову" />}
              {profileSummaryOpen && sharedAttachments.length > 0 && (
                <ChatFilesDropdown
                  files={sharedAttachments}
                  open={chatFilesOpen}
                  onToggle={() => setChatFilesOpen((value) => !value)}
                />
              )}
              {chatFilesOpen ? (
                <ChatFilesGrid files={sharedAttachments} />
              ) : (
                <PanelMessageStream
                  key={`stream:${selectedThreadId}`}
                  messages={messages}
                  currentUserId={user?.id ?? ''}
                  canLoadOlder={Boolean(messagePages.hasNextPage)}
                  loadingOlder={messagePages.isFetchingNextPage}
                  onLoadOlder={() => messagePages.fetchNextPage()}
                />
              )}
              {detail.data.canPost && (
                <MessageComposer
                  key={`composer:${detail.data.id}`}
                  threadId={detail.data.id}
                  replyTo={null}
                  attachments={attachments}
                  sending={send.isPending}
                  uploading={upload.isPending}
                  error={composerError}
                  onReplyCancel={() => {}}
                  onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                  onFiles={(files) => upload.mutate(files)}
                  onDriveAttachment={(attachment) => setAttachments((current) => [...current, attachment].slice(0, 5))}
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

function CompactProfileSummary({
  profile,
  fallback,
  loading,
  error,
  onRetry,
}: {
  profile?: EmployeeProfile
  fallback?: { displayName: string; username: string; jobTitle: string }
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  if (loading && !fallback) return <div className="right-panel__profile-summary"><Skeleton rows={2} /></div>
  return (
    <section className="right-panel__profile-summary" aria-label="Коротка інформація про користувача">
      {(error || (!profile && !loading)) && (
        <div className="right-panel__profile-notice" role="status">
          <CircleAlert size={16} />
          <span><strong>Деталі профілю недоступні</strong><small>Чат і файли продовжують працювати.</small></span>
          <button type="button" onClick={onRetry}>Повторити</button>
        </div>
      )}
      <dl>
        <div>
          <dt><Building2 size={17} />Компанія</dt>
          <dd>{profile?.primaryCompany?.displayName ?? 'Не вказано'}</dd>
        </div>
        <div>
          <dt><Network size={17} />Підрозділ</dt>
          <dd className="employee-hierarchy">
            {profile?.orgUnit
              ? profile.orgUnit.parent
                ? `${profile.orgUnit.parent.name} → ${profile.orgUnit.name}`
                : profile.orgUnit.name
              : 'Не вказано'}
          </dd>
        </div>
        <div>
          <dt><BriefcaseBusiness size={17} />Посада</dt>
          <dd>{profile?.positionTitle || profile?.jobTitle || fallback?.jobTitle || 'Не вказано'}</dd>
        </div>
        <div>
          <dt><Phone size={17} />Телефон</dt>
          <dd>{profile?.phone ? <a href={`tel:${profile.phone}`}>{profile.phone}</a> : 'Не вказано'}</dd>
        </div>
        <div>
          <dt><Mail size={17} />Email</dt>
          <dd>{profile?.contactEmail ? <a href={`mailto:${profile.contactEmail}`}>{profile.contactEmail}</a> : 'Не вказано'}</dd>
        </div>
      </dl>
    </section>
  )
}

function ChatFilesDropdown({
  files,
  open,
  onToggle,
}: {
  files: ChatAttachmentView[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="right-panel__chat-files" aria-label="Файли в чаті">
      <button
        type="button"
        className={open ? 'is-open' : ''}
        aria-expanded={open}
        aria-controls="right-panel-chat-files-grid"
        onClick={onToggle}
      >
        <span>Файли в чаті</span>
        <b>{files.length}</b>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
    </section>
  )
}

function ChatFilesGrid({ files }: { files: ChatAttachmentView[] }) {
  const [previewFile, setPreviewFile] = useState<ChatAttachmentView | null>(null)
  return (
    <>
      <div className="right-panel__chat-files-grid" id="right-panel-chat-files-grid">
        {files.map((file) => file.scanStatus === 'CLEAN' ? (
          <button type="button" key={file.id} title={file.fileName} onClick={() => setPreviewFile(file)}>
            {isPreviewableImage(file)
              ? <img src={panelAttachmentUrl(file)} alt={file.fileName} loading="lazy" />
              : <span><FileText size={20} /></span>}
            <small>{file.fileName}</small>
          </button>
        ) : (
          <div key={file.id} title={file.fileName}>
            <span><FileText size={20} /></span>
            <small>{file.fileName}</small>
          </div>
        ))}
      </div>
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </>
  )
}

function DirectDraftComposer({
  contact,
  sending,
  error,
  onEdit,
  onSend,
}: {
  contact: ChatContactUser
  sending: boolean
  error: string
  onEdit: () => void
  onSend: (input: { body: string; files: File[] }) => Promise<boolean>
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [contact.id])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0'
    textarea.style.height = `${Math.min(144, textarea.scrollHeight)}px`
  }, [body])

  function addFiles(nextFiles: File[]) {
    if (!nextFiles.length || sending) return
    onEdit()
    setFiles((current) => [...current, ...nextFiles].slice(0, 5))
  }

  async function submit() {
    if ((!body.trim() && files.length === 0) || sending || submittingRef.current) return
    submittingRef.current = true
    try {
      const sent = await onSend({ body: body.trim(), files })
      if (sent) {
        setBody('')
        setFiles([])
      }
    } finally {
      submittingRef.current = false
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = [...event.clipboardData.files]
    if (!pastedFiles.length) return
    event.preventDefault()
    addFiles(pastedFiles)
  }

  const { isDragging, dropTargetProps } = useFileDropTarget({
    disabled: sending || files.length >= 5,
    onFiles: addFiles,
  })

  return (
    <div
      className="message-composer right-panel__draft-composer is-file-drop-target"
      {...dropTargetProps}
    >
      <FileDropOverlay active={isDragging} label="Відпустіть файли, щоб прикріпити" />
      {files.length > 0 && (
        <div className="message-composer__attachments">
          {files.map((file, index) => (
            <span key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
              <FileText size={15} />
              {file.name}
              <button
                type="button"
                aria-label={`Прибрати ${file.name}`}
                disabled={sending}
                onClick={() => {
                  onEdit()
                  setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                }}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="message-composer__row">
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          disabled={sending || files.length >= 5}
          onChange={(event) => {
            addFiles([...event.target.files ?? []])
            event.target.value = ''
          }}
        />
        <button
          type="button"
          aria-label="Додати файли"
          title="Додати файли або перетягнути їх сюди"
          disabled={sending || files.length >= 5}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip size={21} />
        </button>
        <textarea
          ref={textareaRef}
          className="message-composer__input"
          aria-label="Повідомлення"
          rows={1}
          maxLength={8_000}
          value={body}
          placeholder="Напишіть повідомлення…"
          disabled={sending}
          onChange={(event) => {
            onEdit()
            setBody(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
          onPaste={handlePaste}
        />
        <button
          type="button"
          className="message-composer__send"
          aria-label="Надіслати"
          disabled={(!body.trim() && files.length === 0) || sending}
          onClick={() => void submit()}
        >
          {sending ? <LoaderCircle className="is-spinning" size={20} /> : <Send size={20} />}
        </button>
      </div>
      <div className="message-composer__status" role="status" aria-live="polite">{error}</div>
    </div>
  )
}

function ConversationEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="right-panel__conversation-empty">
      <MessageCircle size={28} />
      <strong>{title}</strong>
      {description && <span>{description}</span>}
    </div>
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
        onKeyDown={scroll.onUserScrollIntent}
        onPointerDown={scroll.onUserScrollIntent}
        onScroll={() => {
          scroll.onScroll()
          const element = scroll.containerRef.current
          if (!element) return
          setShowBottom(element.scrollHeight - element.scrollTop - element.clientHeight > 180)
          if (element.scrollTop <= 72) loadOlder()
        }}
        onTouchStart={scroll.onUserScrollIntent}
        onWheel={scroll.onUserScrollIntent}
      >
        {loadingOlder && (
          <div className="right-panel__messages-loader" role="status">
            <LoaderCircle className="is-spinning" size={15} />
            Завантажуємо попередні повідомлення…
          </div>
        )}
        <div ref={scroll.contentRef} className="right-panel__message-list">
          {messages.map((message) => (
            <CompactMessage key={message.id} message={message} own={message.authorId === currentUserId} />
          ))}
        </div>
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
  const [previewFile, setPreviewFile] = useState<ChatAttachmentView | null>(null)
  const singleImageAttachment = message.attachments.length === 1 && isPreviewableImage(message.attachments[0]!)
    ? message.attachments[0]
    : null
  const deliveryLabel = message.id.startsWith('optimistic:')
    ? 'Надсилається'
    : message.readByCount > 0
      ? message.readByCount > 1 ? `Прочитано: ${message.readByCount}` : 'Прочитано'
      : 'Відправлено'
  const messageMeta = (
    <footer className="right-panel__message-meta">
      {singleImageAttachment && <CompactFileName fileName={singleImageAttachment.fileName} />}
      <time>{formatChatTime(message.createdAt)}{message.editedAt ? ' · змінено' : ''}</time>
      {own && (
        <span
          className={`right-panel__message-delivery ${message.readByCount > 0 ? 'is-read' : ''}`}
          title={deliveryLabel}
        >
          {message.readByCount > 0 ? <CheckCheck size={13} /> : <Check size={13} />}
        </span>
      )}
    </footer>
  )
  return (
    <article className={`right-panel__message ${own ? 'is-own' : ''}`}>
      {!own && (
        <UserProfileLink
          className="right-panel__message-author-avatar"
          userId={message.author.id}
          aria-label={`Відкрити профіль ${message.author.displayName}`}
        >
          <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />
        </UserProfileLink>
      )}
      <div>
        {!own && <UserProfileLink className="right-panel__message-author" userId={message.author.id}>{message.author.displayName}</UserProfileLink>}
        {message.deletedAt ? (
          <div className="right-panel__message-content">
            <p className="is-deleted">Повідомлення видалено</p>
            {messageMeta}
          </div>
        ) : message.body ? (
          <div className="right-panel__message-content">
            <p>{message.body}</p>
            {messageMeta}
          </div>
        ) : null}
        {message.attachments.map((attachment) => isPreviewableImage(attachment) ? (
          <button
            type="button"
            className="right-panel__message-image"
            key={attachment.id}
            aria-label={`Переглянути ${attachment.fileName}`}
            onClick={() => setPreviewFile(attachment)}
          >
            <img src={panelAttachmentUrl(attachment)} alt={attachment.fileName} loading="lazy" />
            {singleImageAttachment?.id !== attachment.id && (
              <span><CompactFileName fileName={attachment.fileName} /></span>
            )}
          </button>
        ) : attachment.scanStatus === 'CLEAN' ? (
          <button type="button" className="right-panel__message-file" key={attachment.id} onClick={() => setPreviewFile(attachment)}>
            <FileText size={15} /><span>{attachment.fileName}</span><small>{formatPanelFileSize(attachment.bytes)}</small>
          </button>
        ) : (
          <span className="right-panel__message-file is-disabled" key={attachment.id}>
            <FileText size={15} /><span>{attachment.fileName}</span><small>Перевіряється</small>
          </span>
        ))}
        {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        {!message.body && !message.deletedAt && messageMeta}
      </div>
    </article>
  )
}
