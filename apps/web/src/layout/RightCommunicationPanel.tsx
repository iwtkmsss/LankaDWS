import { conversationName, personName, personPatronymic, personNamesInLabel } from '../shared/lib/personName'
import { useDocumentVisible } from '../shared/lib/useDocumentVisible'
import { useEntityNotificationRead } from '../features/notifications/useEntityNotificationRead'
import { useReadingMessageThread } from '../features/messages/lib/messageSound'
import { sortThreadsWithDrafts, useMessageDrafts } from '../features/messages/lib/messageDrafts'
import { useChatPin } from '../features/messages/hooks/useChatPin'
import { ChatPinButton } from '../features/messages/components/ChatPinButton'
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
  Bell,
  BellRing,
  BriefcaseBusiness,
  Building2,
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
  Search,
  Send,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type ComponentProps } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getMessagePage,
  getMessage,
  setMessageReaction,
  getChatUser,
  getThreadDetail,
  getThreadPage,
  createThread,
  sendMessage,
  uploadMessageAttachments,
} from '../features/messages/api/messageApi'
import { messageKeys } from '../features/messages/api/messageKeys'
import { MessageBubble } from '../features/messages/components/MessageBubble'
import { continuesMessageGroup } from '../shared/messages/messageGrouping'
import { ForwardMessageDrawer } from '../features/messages/components/ForwardMessageDrawer'
import { upsertMessageCache } from '../features/messages/lib/messageCache'
import { formatChatTime } from '../features/messages/lib/chatDates'
import { MessageComposer } from '../features/messages/components/MessageComposer'
import { usePreservedChatScroll } from '../features/messages/hooks/usePreservedChatScroll'
import { useUserSearch } from '../shared/lib/useUserSearch'
import { MessageComposerFrame } from '../shared/messages/MessageComposerFrame'
import { normalizedCodePointLength } from '../features/messages/lib/messageText'
import '../features/messages/messages.css'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { Avatar, ErrorState, IconButton, Skeleton } from '../shared/ui'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import { FileThumbnail } from '../shared/files/FileThumbnail'
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
  CALENDAR: 'Календар',
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
  if (item.entityType === 'EVENT') return `/calendar/events/${encodeURIComponent(item.entityId)}`
  if (item.entityType === 'MESSAGE_THREAD') return `/messages/${item.entityId}`
  if (item.entityType === 'FEED_POST') return `/feed?post=${encodeURIComponent(item.entityId)}`
  if (item.entityType === 'USER') return '/settings/security'
  return null
}

function ThreadAvatar({ thread }: { thread: ChatThreadListItem }) {
  if (thread.kind === 'DIRECT') return <Avatar name={conversationName(thread)} src={thread.avatarAsset} />
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
          <MessageCircle size={16} aria-hidden />Чат
          {chatUnread > 0 && <b>{Math.min(chatUnread, 99)}</b>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notifications'}
          className={tab === 'notifications' ? 'is-active' : ''}
          onClick={() => onChange('notifications')}
        >
          <Bell size={16} aria-hidden />Сповіщення
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
  const drafts = useMessageDrafts(user?.id ?? '')
  const chatPin = useChatPin()
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
  const [chatUserQuery, setChatUserQuery] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([])
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null)
  const [forwarding, setForwarding] = useState<ChatMessageView | null>(null)
  const [messageActionError, setMessageActionError] = useState('')
  const [profileSummaryOpen, setProfileSummaryOpen] = useState(false)
  const [chatFilesOpen, setChatFilesOpen] = useState(false)
  const [bottomThreadId, setBottomThreadId] = useState<string | null>(null)
  const [sentMessageVersion, setSentMessageVersion] = useState(0)
  const onBottomChange = useCallback((threadId: string, atBottom: boolean) => {
    setBottomThreadId(atBottom ? threadId : null)
  }, [])
  const markedReadRef = useRef('')
  const sendAttemptRef = useRef({ signature: '', key: '' })
  const documentVisible = useDocumentVisible()
  const draftSendAttemptRef = useRef({
    signature: '',
    threadId: '',
    threadKey: '',
    messageKey: '',
    attachments: [] as ChatAttachmentView[],
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
  const threads = useMemo(() => sortThreadsWithDrafts([
    ...new Map(
      (threadPages.data?.pages.flatMap((page) => page.items) ?? [])
        .map((thread) => [thread.id, thread]),
    ).values(),
  ], drafts), [threadPages.data, drafts])
  const selectedPreview = threads.find((thread) => thread.id === selectedThreadId)
  const {
    users: chatUserSearch,
    items: chatSearchItems,
    debouncedValue: debouncedChatUserQuery,
    onCompositionStart: onChatSearchCompositionStart,
    onCompositionEnd: onChatSearchCompositionEnd,
  } = useUserSearch<ChatContactUser>(chatUserQuery, {
    endpoint: '/messages/users/search', params: { company: 'all' }, enabled: tab === 'chat' && chatSearchOpen,
  })

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
  useEntityNotificationRead('MESSAGE_THREAD', tab === 'chat' && chatScreen === 'conversation'
    && detail.isSuccess && messagePages.isSuccess ? selectedThreadId ?? undefined : undefined, detail.dataUpdatedAt)
  useReadingMessageThread(user?.id, tab === 'chat' && chatScreen === 'conversation'
    && detail.isSuccess && messagePages.isSuccess ? selectedThreadId ?? undefined : undefined)
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
    draftSendAttemptRef.current = {
      signature: '',
      threadId: '',
      threadKey: '',
      messageKey: '',
      attachments: [],
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
          attachments: [],
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
      if (files.length && attempt.attachments.length !== files.length) {
        const result = await uploadMessageAttachments(attempt.threadId, files)
        if (result.failed) throw new Error('chat_attachment_upload_failed')
        attempt.attachments = result.uploaded
      }
      await sendMessage(attempt.threadId, {
        body,
        mentions: [],
        attachmentIds: attempt.attachments.map((attachment) => attachment.id),
      }, attempt.messageKey, attempt.attachments)
      return { threadId: attempt.threadId }
    },
    onSuccess: async ({ threadId }) => {
      setSelectedThreadId(threadId)
      draftSendAttemptRef.current = {
        signature: '',
        threadId: '',
        threadKey: '',
        messageKey: '',
        attachments: [],
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: messageKeys.pages(threadId) }),
        client.invalidateQueries({ queryKey: messageKeys.detail(threadId) }),
        client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
        client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
      ])
    },
  })

  useEffect(() => {
    setReplyTo(null)
    setForwarding(null)
    setMessageActionError('')
  }, [selectedThreadId, props.targetUserId])

  async function likeMessage(message: ChatMessageView) {
    const threadId = selectedThreadId
    if (!threadId) return
    setMessageActionError('')
    try {
      upsertMessageCache(client, threadId, await setMessageReaction(message.id, !message.reactions.likedByMe))
    } catch {
      setMessageActionError('Не вдалося змінити вподобання. Спробуйте ще раз.')
    }
  }

  async function updateMessage(message: ChatMessageView, body?: string, mentions?: StructuredMentionInput[], attachmentIds?: string[]) {
    const threadId = selectedThreadId
    if (!threadId) return
    setMessageActionError('')
    try {
      await api(`/messages/${encodeURIComponent(message.id)}`, {
        method: body === undefined ? 'DELETE' : 'PATCH',
        body: jsonBody({ body, mentions, attachmentIds, expectedVersion: message.version }),
      })
      upsertMessageCache(client, threadId, await getMessage(message.id))
    } catch {
      setMessageActionError('Не вдалося змінити повідомлення. Спробуйте ще раз.')
      if (body !== undefined) throw new Error('message_edit_failed')
    }
  }

  const send = useMutation({
    mutationFn: (input: { body: string; mentions: StructuredMentionInput[] }) => {
      const payload = {
        body: input.body,
        mentions: input.mentions,
        replyToId: replyTo?.id ?? null,
        attachmentIds: attachments.map((attachment) => attachment.id),
      }
      const signature = JSON.stringify({ threadId: selectedThreadId, ...payload })
      if (sendAttemptRef.current.signature !== signature) {
        sendAttemptRef.current = { signature, key: idempotencyKey('right-panel-message') }
      }
      return sendMessage(selectedThreadId!, payload, sendAttemptRef.current.key, attachments)
    },
    onSuccess: async () => {
      sendAttemptRef.current = { signature: '', key: '' }
      setSentMessageVersion((version) => version + 1)
      setReplyTo(null)
      setAttachments([])
      await Promise.all([
        client.invalidateQueries({ queryKey: messageKeys.pages(selectedThreadId!) }),
        client.invalidateQueries({ queryKey: messageKeys.detail(selectedThreadId!) }),
        client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
        client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
      ])
    },
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      return uploadMessageAttachments(selectedThreadId!, files)
    },
    onSuccess: ({ uploaded }) => {
      setAttachments((current) => [...current, ...uploaded])
    },
  })
  const { isDragging: isConversationDragging, dropTargetProps: conversationDropTargetProps } = useFileDropTarget({
    disabled: tab !== 'chat'
      || chatScreen !== 'conversation'
      || !detail.data?.canPost
      || upload.isPending,
    onFiles: (files) => upload.mutate(files),
  })
  const markThreadRead = useMutation({
    retry: 2,
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
    const marker = selectedThreadId && lastMessageId
      ? `${selectedThreadId}:${lastMessageId}:${messages.map((message) => `${message.id}:${message.version}:${message.reactions.likeCount}`).join('|')}`
      : ''
    if (!marker || markedReadRef.current === marker || chatScreen !== 'conversation' || tab !== 'chat'
      || bottomThreadId !== selectedThreadId || chatFilesOpen
      || !documentVisible || !messages.some((message) => message.id === lastMessageId)) return
    markedReadRef.current = marker
    markThreadRead.mutate({ threadId: selectedThreadId!, messageId: lastMessageId! })
  }, [chatScreen, tab, detail.data?.lastMessageId, selectedThreadId, messages, documentVisible, bottomThreadId, chatFilesOpen])

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
  }

  function openUserChat(contact: ChatContactUser) {
    setChatUserQuery('')
    setChatSearchOpen(false)
    if (contact.directThreadId) {
      selectThread(contact.directThreadId)
      return
    }
    navigate(`/messages?to=${encodeURIComponent(contact.id)}`)
    props.onClose()
  }

  function openNotification(item: NotificationItem) {
    if (item.entityType === 'MESSAGE_THREAD' && item.entityId) {
      setTab('chat')
      selectThread(item.entityId)
      return
    }
    const route = notificationRoute(item)
    if (route) navigate(route)
    else if (!item.readAt) markNotification.mutate({ id: item.id, read: true })
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
          <div className="right-panel__screen-heading right-panel__threads-heading">
            <div
              className="right-panel__user-search"
              onFocusCapture={() => setChatSearchOpen(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setChatSearchOpen(false)
              }}
            >
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={chatUserQuery}
                placeholder="Пошук людей"
                aria-label="Пошук користувачів для чату"
                aria-autocomplete="list"
                aria-expanded={chatSearchOpen && Boolean(chatUserQuery)}
                onChange={(event) => setChatUserQuery(event.target.value)}
                onCompositionStart={onChatSearchCompositionStart}
                onCompositionEnd={onChatSearchCompositionEnd}
              />
              {chatSearchOpen && normalizedCodePointLength(chatUserQuery) >= 1 && (
                <div className="right-panel__user-search-results" role="listbox" aria-label="Користувачі">
                  {chatUserSearch.isLoading || chatUserQuery !== debouncedChatUserQuery ? (
                    <span>Шукаємо…</span>
                  ) : chatSearchItems.length ? chatSearchItems.map((contact) => (
                    <button key={contact.id} type="button" role="option" onClick={() => openUserChat(contact)}>
                      <Avatar name={personName(contact.displayName)} src={contact.avatarAsset} />
                      <span><strong>{personName(contact.displayName)}</strong><small>{personPatronymic(contact.displayName)}</small></span>
                    </button>
                  )) : <span>Користувачів не знайдено</span>}
                </div>
              )}
            </div>
          </div>
          {threadPages.isLoading ? <Skeleton rows={7} /> : threadPages.isError ? (
            <ErrorState title="Не вдалося завантажити діалоги" onRetry={() => void threadPages.refetch()} />
          ) : threads.length ? (
            <div className="right-panel__thread-list">
              {chatPin.error && <p role="alert">Не вдалося змінити закріплення чату. Спробуйте ще раз.</p>}
              {threads.map((thread) => (
                <div className={`message-thread-entry${thread.unread ? ' is-unread' : ''}`} key={thread.id}>
                <button
                  type="button"
                  key={thread.id}
                  className={`message-thread-select${thread.unread ? ' is-unread' : ''}`}
                  onClick={() => selectThread(thread.id)}
                >
                  <ThreadAvatar thread={thread} />
                  <span>
                    <span><strong>{conversationName(thread)}</strong></span>
                    <span><small>{drafts[thread.id]?.body.trim()
                      ? <><span className="message-draft-label">Чернетка:</span> {drafts[thread.id]!.body}</>
                      : thread.lastMessage || 'Почніть розмову'}</small></span>
                  </span>
                </button>
                <div className="message-thread-meta">
                <time>{drafts[thread.id]?.createdAt
                  ? formatChatTime(new Date(drafts[thread.id]!.createdAt).toISOString())
                  : thread.lastMessageAt ? formatChatTime(thread.lastMessageAt) : ''}</time>
                {thread.unreadCount > 0
                  ? <b className="right-panel__thread-unread" aria-label={`Непрочитаних повідомлень: ${thread.unreadCount}`}>{thread.unreadCount > 99 ? '99+' : thread.unreadCount}</b>
                  : <ChatPinButton pinned={Boolean(thread.pinned)} name={conversationName(thread)}
                    disabled={chatPin.pending} onClick={() => chatPin.toggle(thread.id, !thread.pinned)} />}
                </div>
                </div>
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
          className="right-panel__screen right-panel__conversation is-file-drop-target"
          aria-label={targetIsCurrentUser
            ? `Профіль: ${personName(profile.data?.displayName) ?? ''}`
            : `Діалог: ${detail.data ? conversationName(detail.data) : selectedPreview ? conversationName(selectedPreview) : personName(profile.data?.displayName) ?? ''}`}
          {...conversationDropTargetProps}
        >
          <FileDropOverlay active={isConversationDragging} label="Відпустіть файли, щоб прикріпити до повідомлення" />
          <div className={`right-panel__person-overview ${profileSummaryOpen ? 'is-open' : ''}`}>
            <header className="right-panel__conversation-header">
              <IconButton label="До списку діалогів" onClick={() => { props.onClearTarget(); setChatScreen('threads'); setProfileSummaryOpen(false) }}><ArrowLeft size={19} /></IconButton>
              <div className="right-panel__person-trigger">
                <Avatar
                  size="lg"
                  name={detail.data ? conversationName(detail.data) : selectedPreview ? conversationName(selectedPreview) : personName(profile.data?.displayName) ?? ''}
                  src={directParticipant?.avatarAsset ?? selectedPreview?.avatarAsset ?? profile.data?.avatarAsset}
                />
                <span>
                  <strong>{detail.data ? conversationName(detail.data) : selectedPreview ? conversationName(selectedPreview) : personName(profile.data?.displayName) ?? 'Відкриваємо чат…'}</strong>
                  <small>{personPatronymic(directParticipant?.displayName ?? profile.data?.displayName ?? targetContact.data?.displayName)}</small>
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
              <div className="right-panel__profile-details">
                <CompactProfileSummary
                  profile={profile.data}
                  fallback={directParticipant ?? undefined}
                  loading={profile.isLoading}
                  error={profile.isError}
                  onRetry={() => void profile.refetch()}
                />
                {sharedAttachments.length > 0 && (
                  <ChatFilesDropdown
                    files={sharedAttachments}
                    open={chatFilesOpen}
                    onToggle={() => setChatFilesOpen((value) => !value)}
                  />
                )}
              </div>
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
                title={`Почніть розмову з ${personName(targetContact.data.displayName)}`}
                description="Чат з’явиться у списку після першого повідомлення."
              />
              <DirectDraftComposer
                key={targetContact.data.id}
                contact={targetContact.data}
                sending={sendDraft.isPending}
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
              {chatFilesOpen ? (
                <ChatFilesGrid files={sharedAttachments} />
              ) : (
                <PanelMessageStream
                  key={`stream:${selectedThreadId}`}
                  threadId={detail.data.id}
                  onReply={setReplyTo}
                  onLike={(message) => { void likeMessage(message) }}
                  onForward={setForwarding}
                  onEdit={(message, body, mentions, attachmentIds) => updateMessage(message, body, mentions, attachmentIds)}
                  onDelete={(message) => updateMessage(message)}
                  messages={messages}
                  currentUserId={user?.id ?? ''}
                  lastReadMessageId={detail.data.lastReadMessageId}
                  unreadCount={selectedPreview?.unreadCount ?? 0}
                  sentMessageVersion={sentMessageVersion}
                  onBottomChange={onBottomChange}
                  canLoadOlder={Boolean(messagePages.hasNextPage)}
                  loadingOlder={messagePages.isFetchingNextPage}
                  onLoadOlder={() => messagePages.fetchNextPage()}
                />
              )}
              {messageActionError && <p className="right-panel__message-action-error" role="alert">{messageActionError}</p>}
              {detail.data.canPost && (
                <MessageComposer
                  currentUserId={user!.id}
                  key={`composer:${detail.data.id}`}
                  threadId={detail.data.id}
                  replyTo={replyTo}
                  attachments={attachments}
                  sending={send.isPending}
                  uploading={upload.isPending}
                  onReplyCancel={() => setReplyTo(null)}
                  onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                  onFiles={(files) => upload.mutate(files)}
                  onDriveAttachment={(attachment) => setAttachments((current) => [...current, attachment])}
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
          <div className="right-panel__screen-heading right-panel__notifications-heading">
            <div className="right-panel__filters" role="tablist" aria-label="Фільтр сповіщень">
              {([
                ['all', 'Усі'],
                ['unread', 'Непрочитані'],
                ['mentions', 'Згадки'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={notificationFilter === value} className={notificationFilter === value ? 'is-active' : ''} onClick={() => setNotificationFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          {notifications.isLoading ? <Skeleton rows={7} /> : notifications.isError ? (
            <ErrorState title="Не вдалося завантажити сповіщення" onRetry={() => void notifications.refetch()} />
          ) : notifications.data?.items.length ? (
            <div className="right-panel__notification-list">
              {notifications.data.items.map((item) => (
                <article className={item.readAt ? '' : 'is-unread'} key={item.id}>
                  <span className={`right-panel__notification-icon right-panel__notification-icon--${item.category.toLowerCase()}`}>{notificationIcon(item.category)}</span>
                  <button type="button" onClick={() => openNotification(item)}>
                    <span><strong>{personNamesInLabel(item.safeTitle)}</strong>{item.requiresAction && <em>Потрібна дія</em>}</span>
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
          <footer className="right-panel__notifications-footer">
            {Boolean(notifications.data?.items.some((item) => !item.readAt)) && (
              <button type="button" disabled={markAllNotifications.isPending} onClick={() => markAllNotifications.mutate()}>Прочитати всі</button>
            )}
            <Link className="right-panel__footer-link" to="/notifications" onClick={props.onClose}>Усі сповіщення <ChevronRight size={16} /></Link>
          </footer>
        </section>
      )}
      {forwarding && selectedThreadId && (
        <ForwardMessageDrawer
          message={forwarding}
          companyScope="all"
          currentThreadId={selectedThreadId}
          onClose={() => setForwarding(null)}
          onForwarded={(threadId) => {
            setForwarding(null)
            void client.invalidateQueries({ queryKey: messageKeys.all })
            selectThread(threadId)
          }}
        />
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
        <span><Paperclip size={16} aria-hidden />Файли в чаті</span>
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
            <FileThumbnail file={file} />
            <small>{file.fileName}</small>
          </button>
        ) : (
          <div key={file.id} title={file.fileName}>
            <FileThumbnail file={file} />
            <small>{file.fileName}</small>
          </div>
        ))}
      </div>
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} openInNewTab />}
    </>
  )
}

function DirectDraftComposer({
  contact,
  sending,
  onEdit,
  onSend,
}: {
  contact: ChatContactUser
  sending: boolean
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
    const style = getComputedStyle(textarea)
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    textarea.style.height = `${Math.min(144, textarea.scrollHeight + borders)}px`
  }, [body])

  function addFiles(nextFiles: File[]) {
    if (!nextFiles.length || sending) return
    onEdit()
    setFiles((current) => [...current, ...nextFiles])
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
    disabled: sending,
    onFiles: addFiles,
  })

  return (
    <MessageComposerFrame
      className="right-panel__draft-composer is-file-drop-target"
      dropTargetProps={dropTargetProps}
      overlay={<FileDropOverlay active={isDragging} label="Відпустіть файли, щоб прикріпити" />}
      attachments={files.length > 0 && (
        <div className="message-composer__attachments">
          {files.map((file, index) => (
            <span key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
              <FileText size={15} />
              <span className="message-composer__attachment-name" title={file.name}>{file.name}</span>
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
      leadingActions={(
        <>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            disabled={sending}
            onChange={(event) => {
              addFiles([...event.target.files ?? []])
              event.target.value = ''
            }}
          />
          <button
            type="button"
            aria-label="Додати файли"
            title="Додати файли або перетягнути їх сюди"
            disabled={sending}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip size={21} />
          </button>
        </>
      )}
      input={(
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
      )}
      sendAction={(
        <button
          type="button"
          className="message-composer__send"
          aria-label="Надіслати"
          disabled={(!body.trim() && files.length === 0) || sending}
          onClick={() => void submit()}
        >
          {sending ? <LoaderCircle className="is-spinning" size={20} /> : <Send size={20} />}
        </button>
      )}
    />
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

type PanelMessageActions = Pick<ComponentProps<typeof MessageBubble>,
  'threadId' | 'onReply' | 'onLike' | 'onForward' | 'onEdit' | 'onDelete'>

function PanelMessageStream({
  threadId,
  onReply,
  onLike,
  onForward,
  onEdit,
  onDelete,
  messages,
  currentUserId,
  lastReadMessageId,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  unreadCount,
  sentMessageVersion,
  onBottomChange,
}: {
  messages: ChatMessageView[]
  currentUserId: string
  lastReadMessageId: string | null
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<unknown>
  unreadCount: number
  sentMessageVersion: number
  onBottomChange: (threadId: string, atBottom: boolean) => void
} & PanelMessageActions) {
  const [showBottom, setShowBottom] = useState(false)
  const loadingRequestedRef = useRef(false)
  const lastScrollTopRef = useRef<number | null>(null)
  const scrollingUpRef = useRef(false)
  const hasScrollIntentRef = useRef(false)
  const pointerYRef = useRef<number | null>(null)
  const touchYRef = useRef<number | null>(null)
  const scroll = usePreservedChatScroll(messages.length)
  const { containerRef, scrollToBottom } = scroll
  const previousSentVersionRef = useRef(sentMessageVersion)

  const updateBottomState = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setShowBottom(distance > 180)
    onBottomChange(threadId, distance < 120)
  }, [containerRef, onBottomChange, threadId])

  useLayoutEffect(() => {
    if (previousSentVersionRef.current !== sentMessageVersion) {
      previousSentVersionRef.current = sentMessageVersion
      scrollToBottom('auto')
    }
    updateBottomState()
  }, [messages, sentMessageVersion, scrollToBottom, updateBottomState])

  useEffect(() => () => onBottomChange(threadId, false), [threadId, onBottomChange])
  const initialReadRef = useRef(lastReadMessageId)
  const openedAtRef = useRef(Date.now())
  const [liveIds, setLiveIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    initialReadRef.current = lastReadMessageId
    openedAtRef.current = Date.now()
    setLiveIds(new Set())
  }, [])

  useEffect(() => {
    const incoming = messages.filter((message) => message.authorId !== currentUserId && Date.parse(message.createdAt) >= openedAtRef.current).map((message) => message.id)
    if (!incoming.length) return
    setLiveIds((current) => new Set([...current, ...incoming]))
  }, [currentUserId, messages])

  const initialReadIndex = initialReadRef.current ? messages.findIndex((message) => message.id === initialReadRef.current) : -1

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

  return (
    <div className="right-panel__message-stage">
      <div
        ref={scroll.containerRef}
        className="right-panel__messages"
        tabIndex={0}
        aria-label="Повідомлення діалогу"
        aria-live="polite"
        onKeyDown={(event) => {
          if (!['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return
          scroll.onUserScrollIntent()
          hasScrollIntentRef.current = true
          scrollingUpRef.current = true
        }}
        onPointerDown={(event) => {
          pointerYRef.current = event.clientY
          lastScrollTopRef.current = event.currentTarget.scrollTop
        }}
        onPointerMove={(event) => {
          if (pointerYRef.current === null) return
          scroll.onUserScrollIntent()
          hasScrollIntentRef.current = true
          scrollingUpRef.current = event.clientY > pointerYRef.current
          pointerYRef.current = event.clientY
        }}
        onPointerUp={() => { pointerYRef.current = null }}
        onScroll={() => {
          const element = scroll.containerRef.current
          if (!element) return
          const previousScrollTop = lastScrollTopRef.current
          const scrolledUp = scrollingUpRef.current
            || (previousScrollTop !== null && element.scrollTop < previousScrollTop)
          lastScrollTopRef.current = element.scrollTop
          scrollingUpRef.current = false
          scroll.onScroll()
          updateBottomState()
          if (hasScrollIntentRef.current && scrolledUp && element.scrollTop <= 72) {
            hasScrollIntentRef.current = false
            loadOlder()
          }
        }}
        onTouchStart={(event) => {
          touchYRef.current = event.touches[0]?.clientY ?? null
        }}
        onTouchMove={(event) => {
          const nextY = event.touches[0]?.clientY
          if (nextY === undefined || touchYRef.current === null) return
          scroll.onUserScrollIntent()
          hasScrollIntentRef.current = true
          scrollingUpRef.current = nextY > touchYRef.current
          touchYRef.current = nextY
        }}
        onWheel={(event) => {
          scroll.onUserScrollIntent()
          hasScrollIntentRef.current = true
          scrollingUpRef.current = event.deltaY < 0
        }}
      >
        {loadingOlder && (
          <div className="right-panel__messages-loader" role="status">
            <LoaderCircle className="is-spinning" size={15} />
            Завантажуємо попередні повідомлення…
          </div>
        )}
        <div ref={scroll.contentRef} className="right-panel__message-list">
          {messages.map((message, index) => {
            const isNew = message.authorId !== currentUserId && (
              initialReadRef.current === null || initialReadIndex === -1 || index > initialReadIndex || liveIds.has(message.id)
            )
            const boundary = isNew && (index === initialReadIndex + 1 || initialReadIndex === -1 && index === 0)
            return <div key={message.id} className={`message-group-item${!boundary && continuesMessageGroup(message, messages[index - 1]) ? ' is-group-continuation' : ''}`}>
              {boundary && <div className="right-panel__new-messages">Нові повідомлення</div>}
              <MessageBubble
                idPrefix="right-panel-message"
                threadId={threadId}
                message={message}
                own={message.authorId === currentUserId}
                showAuthor={boundary || !continuesMessageGroup(message, messages[index - 1])}
                showAvatar={!continuesMessageGroup(message, messages[index + 1])}
                isNew={isNew}
                onReply={onReply}
                onLike={onLike}
                onForward={onForward}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </div>
          })}
        </div>
      </div>
      {showBottom && (
        <IconButton
          className="right-panel__messages-bottom"
          label={unreadCount > 0 ? `До нових повідомлень: ${unreadCount} непрочитаних` : 'До нових повідомлень'}
          onClick={() => scroll.scrollToBottom()}
        >
          <ChevronDown size={28} />
          {unreadCount > 0 && <span className="right-panel__messages-bottom-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </IconButton>
      )}
    </div>
  )
}
