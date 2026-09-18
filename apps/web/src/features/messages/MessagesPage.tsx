import type {
  ChatAttachmentView,
  ChatContactUser,
  ChatMessagePage,
  ChatMessageView,
  PrincipalView,
  StructuredMentionInput,
} from '@lankadws/contracts'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody, randomId } from '../../shared/api/client'
import { useAuth } from '../../shared/auth/AuthProvider'
import { useTopbarContent } from '../../layout/TopbarContent'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { Button, EmptyState, ErrorState, Skeleton } from '../../shared/ui'
import {
  createThread,
  getChatUser,
  getMessage,
  getMessagePage,
  getRecommendedChatUsers,
  getThreadDetail,
  getThreadPage,
  searchChatUsers,
  sendMessage,
  setMessageReaction,
  uploadMessageAttachments,
} from './api/messageApi'
import { messageKeys } from './api/messageKeys'
import { ConversationPane } from './components/ConversationPane'
import { DirectDraftPane } from './components/DirectDraftPane'
import { MessagesSidebar } from './components/MessagesSidebar'
import { NewChatDrawer } from './components/NewChatDrawer'
import { ForwardMessageDrawer } from './components/ForwardMessageDrawer'
import { NewGroupDrawer } from './components/NewGroupDrawer'
import { ThreadInfoDrawer } from './components/ThreadInfoDrawer'
import { useUserProfile } from '../employees/UserProfileDrawer'
import { replyPreviewText } from './lib/replyPreview'
import {
  addOptimisticMessage,
  removeMessageCache,
  upsertMessageCache,
} from './lib/messageCache'
import { normalizedCodePointLength } from './lib/messageText'
import './messages.css'

export function chatThreadCompanyScope(
  user: {
    accountType: PrincipalView['accountType']
    company: { id: string } | null
  } | null,
): string {
  return user ? 'all' : ''
}

export interface ChatCompanyOption {
  id: string
  name: string
  isActive: boolean
}

export function chatCreationCompanyId(
  user: {
    accountType: PrincipalView['accountType']
    company: { id: string } | null
  } | null,
  requestedCompanyId: string | null,
  companies: ChatCompanyOption[] = [],
): string {
  if (user?.company?.id) return user.company.id
  if (user?.accountType !== 'ADMIN') return ''
  const activeCompanies = companies.filter((company) => company.isActive)
  return activeCompanies.some((company) => company.id === requestedCompanyId)
    ? requestedCompanyId!
    : (activeCompanies[0]?.id ?? '')
}

export function MessagesPage() {
  const { threadId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { user } = useAuth()
  const { openUserProfile } = useUserProfile()
  const threadCompanyScope = chatThreadCompanyScope(user)
  const adminCompanies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: ChatCompanyOption[] }>('/admin/companies'),
    enabled: user?.accountType === 'ADMIN' && !user.company,
    staleTime: 30_000,
  })
  const creationCompanies = adminCompanies.data?.items.filter((company) => company.isActive) ?? []
  const companyId = chatCreationCompanyId(user, params.get('company'), creationCompanies)
  const unreadOnly = params.get('unread') === 'true'
  const composeOpen = params.get('new') === '1'
  const groupOpen = params.get('group') === '1'
  const targetUserId = params.get('to')
  const [query, setQuery] = useState(params.get('q') ?? '')
  const {
    debouncedValue: debouncedQuery,
    isComposing: isSearchComposing,
    onCompositionStart: onSearchCompositionStart,
    onCompositionEnd: onSearchCompositionEnd,
  } = useDebouncedSearchValue(query)
  const [startingUserId, setStartingUserId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([])
  const [draftBody, setDraftBody] = useState('')
  const [composerSeed, setComposerSeed] = useState<{ threadId: string; body: string; attachments: ChatAttachmentView[] } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [forwarding, setForwarding] = useState<ChatMessageView | null>(null)
  const markedReadRef = useRef('')
  const directAttemptRef = useRef({ userId: '', key: '' })
  const directStartingRef = useRef('')
  const sendAttemptRef = useRef({ signature: '', key: '', tempId: '' })
  const draftBodyRef = useRef('')
  const pendingDraftFilesRef = useRef<File[]>([])
  // The message SSE stream is opened once at the shell level (AppShell);
  // mounting it here as well would open a second EventSource per user.

  useEffect(() => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (query) next.set('q', query)
      else next.delete('q')
      return next
    }, { replace: true })
  }, [query, setParams])

  const threadPages = useInfiniteQuery({
    queryKey: messageKeys.threads(threadCompanyScope, unreadOnly),
    queryFn: ({ pageParam, signal }) =>
      getThreadPage(threadCompanyScope, unreadOnly, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(threadCompanyScope),
  })
  const threads = useMemo(() => {
    const seen = new Set<string>()
    return (threadPages.data?.pages.flatMap((page) => page.items) ?? []).filter((thread) => {
      if (seen.has(thread.id)) return false
      seen.add(thread.id)
      return true
    })
  }, [threadPages.data])
  const counts = threadPages.data?.pages[0]?.counts ?? { all: 0, unread: 0 }

  const canWrite = true
  const normalizedSearchLength = normalizedCodePointLength(debouncedQuery)
  const users = useQuery({
    queryKey: messageKeys.users(companyId, debouncedQuery),
    queryFn: ({ signal }) => searchChatUsers(companyId, debouncedQuery, signal),
    enabled: Boolean(companyId && canWrite && !isSearchComposing && normalizedSearchLength >= 1),
  })
  const recommendations = useQuery({
    queryKey: messageKeys.recommended(companyId),
    queryFn: ({ signal }) => getRecommendedChatUsers(companyId, signal),
    enabled: Boolean(companyId && canWrite && !query),
    staleTime: 60_000,
  })
  const targetContact = useQuery({
    queryKey: [...messageKeys.users(companyId, ''), 'target', targetUserId],
    queryFn: ({ signal }) => getChatUser(companyId, targetUserId!, signal),
    enabled: Boolean(companyId && targetUserId && !threadId),
  })

  const detail = useQuery({
    queryKey: messageKeys.detail(threadId ?? ''),
    queryFn: ({ signal }) => getThreadDetail(threadId!, signal),
    enabled: Boolean(threadId),
  })
  const messagePages = useInfiniteQuery({
    queryKey: messageKeys.pages(threadId ?? ''),
    queryFn: ({ pageParam, signal }) =>
      getMessagePage(threadId!, pageParam ? { before: pageParam } : {}, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.olderCursor ?? undefined,
    enabled: Boolean(threadId),
  })
  const messages = useMemo(() => {
    const seen = new Set<string>()
    return (messagePages.data?.pages.flatMap((page) => page.items.slice().reverse()) ?? []).filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [messagePages.data])
  const selectedPreview = threads.find((thread) => thread.id === threadId)

  const direct = useMutation({
    mutationFn: async (contact: ChatContactUser) => {
      setStartingUserId(contact.id)
      if (directAttemptRef.current.userId !== contact.id) {
        directAttemptRef.current = {
          userId: contact.id,
          key: `chat-direct:${randomId()}`,
        }
      }
      return createThread({
        companyId,
        kind: 'DIRECT',
        participantIds: [contact.id],
      }, directAttemptRef.current.key)
    },
    onSuccess: async (thread) => {
      directStartingRef.current = ''
      directAttemptRef.current = { userId: '', key: '' }
      setStartingUserId(null)
      setQuery('')
      const pendingFiles = pendingDraftFilesRef.current
      pendingDraftFilesRef.current = []
      let uploadedAttachments: ChatAttachmentView[] = []
      if (pendingFiles.length) {
        const result = await uploadMessageAttachments(thread.id, pendingFiles)
        uploadedAttachments = result.uploaded
      }
      setComposerSeed({ threadId: thread.id, body: draftBodyRef.current, attachments: uploadedAttachments })
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
      navigate(`/messages/${thread.id}`)
    },
    onError: () => {
      directStartingRef.current = ''
      setStartingUserId(null)
    },
  })

  useEffect(() => {
    const existingThreadId = targetContact.data?.directThreadId
    if (targetUserId && existingThreadId) navigate(`/messages/${existingThreadId}`, { replace: true })
  }, [navigate, targetContact.data?.directThreadId, targetUserId])

  useEffect(() => {
    draftBodyRef.current = ''
    pendingDraftFilesRef.current = []
    setDraftBody('')
    directAttemptRef.current = { userId: '', key: '' }
    directStartingRef.current = ''
    direct.reset()
  }, [targetUserId])

  useEffect(() => {
    if (threadId || targetUserId) setQuery('')
  }, [targetUserId, threadId])

  const send = useMutation({
    mutationFn: async (input: {
      body: string
      reply: ChatMessageView | null
      attachments: ChatAttachmentView[]
      mentions: StructuredMentionInput[]
      signature: string
      key: string
      tempId: string
    }) => {
      const result = await sendMessage(threadId!, {
        body: input.body,
        replyToId: input.reply?.id ?? null,
        attachmentIds: input.attachments.map((attachment) => attachment.id),
        mentions: input.mentions,
      }, input.key)
      return { ...result, tempId: input.tempId }
    },
    onSuccess: async (result) => {
      const serverMessage = await getMessage(result.id)
      upsertMessageCache(client, threadId!, serverMessage, result.tempId)
      setReplyTo(null)
      setAttachments([])
      sendAttemptRef.current = { signature: '', key: '', tempId: '' }
      await client.invalidateQueries({ queryKey: messageKeys.detail(threadId!) })
    },
    onError: (_error, input) => {
      removeMessageCache(client, threadId!, input.tempId)
    },
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      return uploadMessageAttachments(threadId!, files)
    },
    onSuccess: ({ uploaded }) => {
      setAttachments((current) => [...current, ...uploaded])
    },
  })

  const markRead = useMutation({
    mutationFn: (messageId: string) => api(`/messages/threads/${threadId}/read`, {
      method: 'POST',
      body: jsonBody({ lastReadMessageId: messageId }),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: messageKeys.detail(threadId!) })
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
      void client.invalidateQueries({ queryKey: ['threads', 'summary'] })
      void client.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: () => { markedReadRef.current = '' },
  })
  useEffect(() => {
    const lastMessageId = detail.data?.lastMessageId
    const marker = threadId && lastMessageId && !highlightedMessageId
      ? `${threadId}:${lastMessageId}`
      : ''
    if (!marker || markedReadRef.current === marker) return
    markedReadRef.current = marker
    markRead.mutate(lastMessageId!)
  }, [detail.data?.lastMessageId, highlightedMessageId, threadId])

  useEffect(() => {
    setReplyTo(null)
    setAttachments(composerSeed?.threadId === threadId ? composerSeed?.attachments ?? [] : [])
    setHighlightedMessageId(null)
    setInfoOpen(false)
    sendAttemptRef.current = { signature: '', key: '', tempId: '' }
  }, [threadId])

  async function editMessage(message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) {
    await api(`/messages/${message.id}`, {
      method: 'PATCH',
      body: jsonBody({ body, mentions, expectedVersion: message.version }),
    })
    upsertMessageCache(client, threadId!, await getMessage(message.id))
  }

  async function deleteMessage(message: ChatMessageView) {
    await api(`/messages/${message.id}`, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: message.version }),
    })
    upsertMessageCache(client, threadId!, await getMessage(message.id))
  }

  async function openSearchResult(messageId: string) {
    const page = await getMessagePage(threadId!, { around: messageId })
    client.setQueryData<InfiniteData<ChatMessagePage>>(messageKeys.pages(threadId!), {
      pages: [page],
      pageParams: [null],
    })
    setHighlightedMessageId(messageId)
  }

  async function returnToLatest() {
    setHighlightedMessageId(null)
    await client.resetQueries({ queryKey: messageKeys.pages(threadId!), exact: true })
  }

  async function submitMessage(input: { body: string; mentions: StructuredMentionInput[] }): Promise<boolean> {
    if (!threadId || !user) return false
    const signature = JSON.stringify({
      threadId,
      body: input.body,
      mentions: input.mentions,
      replyToId: replyTo?.id ?? null,
      attachmentIds: attachments.map((attachment) => attachment.id),
    })
    if (sendAttemptRef.current.signature !== signature) {
      sendAttemptRef.current = {
        signature,
        key: `chat-message:${randomId()}`,
        tempId: `optimistic:${randomId()}`,
      }
    }
    const attempt = sendAttemptRef.current
    const optimistic: ChatMessageView = {
      id: attempt.tempId,
      authorId: user.id,
      body: input.body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      version: 1,
      replyToId: replyTo?.id ?? null,
      mentions: input.mentions.map((mention) => ({
        userId: mention.userId,
        start: mention.start,
        end: mention.end,
        active: true,
      })),
      replyPreview: replyTo ? {
        id: replyTo.id,
        authorName: replyTo.author.displayName,
        body: replyPreviewText(replyTo),
      } : null,
      author: {
        id: user.id,
        displayName: user.displayName,
        avatarAsset: user.avatarAsset,
      },
      attachments,
      readByCount: 0,
      reactions: { likeCount: 0, likedByMe: false },
      canEdit: true,
      canDelete: true,
    }
    addOptimisticMessage(client, threadId, optimistic)
    try {
      await send.mutateAsync({
        body: input.body,
        mentions: input.mentions,
        reply: replyTo,
        attachments,
        ...attempt,
      })
      return true
    } catch {
      return false
    }
  }

  function updateUnread(value: boolean) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('unread', 'true')
      else next.delete('unread')
      return next
    }, { replace: true })
  }

  function closeCompose() {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('new')
      next.delete('to')
      return next
    }, { replace: true })
  }

  // A like is a reaction on the message, not a reply: the author learns about
  // it through a notification instead of a new bubble in the conversation.
  async function likeMessage(message: ChatMessageView) {
    if (!threadId) return
    try {
      upsertMessageCache(client, threadId, await setMessageReaction(
        message.id,
        !message.reactions.likedByMe,
      ))
    } catch {}
  }

  function openDirect(contact: ChatContactUser) {
    if (contact.directThreadId) {
      navigate(`/messages/${contact.directThreadId}`)
      return
    }
    const next = new URLSearchParams()
    if (unreadOnly) next.set('unread', 'true')
    if (!user?.company && companyId) next.set('company', companyId)
    next.set('to', contact.id)
    navigate(`/messages?${next}`)
  }

  function closeGroup() {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('group')
      return next
    }, { replace: true })
  }

  function openGroup() {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('new')
      next.delete('to')
      next.set('group', '1')
      return next
    })
  }

  const newChatAction = useMemo(() => (
    <Button type="button" onClick={() => {
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.set('new', '1')
        next.delete('to')
        return next
      })
    }}>
      <MessageCircle size={16} /> Новий чат
    </Button>
  ), [setParams])
  useTopbarContent(newChatAction)

  return (
    <div className={`messages-workspace ${threadId || targetUserId ? 'has-thread' : ''}`}>
      <MessagesSidebar
        threads={threads}
        counts={counts}
        selectedThreadId={threadId}
        unreadOnly={unreadOnly}
          query={query}
          debouncedQuery={debouncedQuery}
          isComposing={isSearchComposing}
        searchResults={users.data?.items ?? []}
        recommendations={recommendations.data?.items ?? []}
        loadingThreads={threadPages.isLoading}
        threadError={threadPages.isError}
        loadingSearch={users.isLoading}
        loadingRecommendations={recommendations.isLoading}
        startingUserId={startingUserId}
        hasMoreThreads={Boolean(threadPages.hasNextPage)}
        loadingMoreThreads={threadPages.isFetchingNextPage}
          onQueryChange={setQuery}
          onSearchCompositionStart={onSearchCompositionStart}
          onSearchCompositionEnd={onSearchCompositionEnd}
        onUnreadChange={updateUnread}
        onSelectThread={(id) => navigate(`/messages/${id}${unreadOnly ? '?unread=true' : ''}`)}
        onStartDirect={openDirect}
        onLoadMore={() => void threadPages.fetchNextPage()}
        onRetryThreads={() => void threadPages.refetch()}
      />

      {threadId ? (
        <ConversationPane
          thread={detail.data}
          preview={selectedPreview}
          messages={messages}
          currentUserId={user?.id ?? ''}
          loading={detail.isLoading || messagePages.isLoading}
          error={detail.isError || messagePages.isError}
          highlightedMessageId={highlightedMessageId}
          canLoadOlder={Boolean(messagePages.hasNextPage)}
          loadingOlder={messagePages.isFetchingNextPage}
          replyTo={replyTo}
          attachments={attachments}
          sending={send.isPending}
          uploading={upload.isPending}
          initialComposerBody={composerSeed?.threadId === threadId ? composerSeed.body : undefined}
          onInitialComposerBodyConsumed={() => setComposerSeed(null)}
          onBack={() => navigate(`/messages?${params}`)}
          onInfo={() => {
            const directParticipant = detail.data?.kind === 'DIRECT'
              ? detail.data.participants.find((participant) => participant.id !== user?.id)
              : null
            if (directParticipant) openUserProfile(directParticipant.id)
            else setInfoOpen(true)
          }}
          onToggleMute={() => {
            if (!detail.data) return
            void api(`/messages/threads/${threadId}/preferences`, {
              method: 'PUT',
              body: jsonBody({
                notificationMode: detail.data.notificationMode === 'NONE' ? 'ALL' : 'NONE',
                expectedVersion: detail.data.participantVersion,
              }),
            }).then(() => client.invalidateQueries({ queryKey: messageKeys.detail(threadId) }))
          }}
          onOpenSearchResult={(id) => void openSearchResult(id)}
          onLatest={() => void returnToLatest()}
          onLoadOlder={() => messagePages.fetchNextPage()}
          onReply={(message) => setReplyTo(message)}
          onLike={likeMessage}
          onForward={(message) => setForwarding(message)}
          onReplyCancel={() => setReplyTo(null)}
          onEdit={editMessage}
          onDelete={deleteMessage}
          onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          onFiles={(files) => upload.mutate(files)}
          onDriveAttachment={(attachment) => setAttachments((current) => [...current, attachment])}
          onSend={submitMessage}
          onRetry={() => {
            void detail.refetch()
            void messagePages.refetch()
          }}
        />
      ) : targetUserId ? (
        targetContact.isLoading ? (
          <section className="conversation-pane conversation-pane--loading"><Skeleton rows={8} /></section>
        ) : targetContact.isError || !targetContact.data ? (
          <section className="conversation-pane"><ErrorState title="Не вдалося відкрити контакт" onRetry={() => void targetContact.refetch()} /></section>
        ) : (
          <DirectDraftPane
            contact={targetContact.data}
            body={draftBody}
            creating={direct.isPending}
            onBack={() => navigate('/messages')}
            onBodyChange={(value) => {
              draftBodyRef.current = value
              setDraftBody(value)
              if (value.trim() && !directStartingRef.current && !direct.isSuccess) {
                directStartingRef.current = targetContact.data.id
                direct.mutate(targetContact.data)
              }
            }}
            onFiles={(files) => {
              pendingDraftFilesRef.current.push(...files)
              if (!directStartingRef.current && !direct.isSuccess) {
                directStartingRef.current = targetContact.data.id
                direct.mutate(targetContact.data)
              }
            }}
          />
        )
      ) : (
        <section className="messages-no-thread" aria-label="Діалог не вибрано">
          <EmptyState
            title="Оберіть діалог"
            description="Знайдіть колегу, відкрийте наявну розмову або створіть робочу групу."
            action={<MessageCircle size={18} aria-hidden="true" />}
          />
        </section>
      )}

      {composeOpen && companyId && (
        <NewChatDrawer
          companyId={companyId}
          targetUserId={targetUserId}
          startingUserId={startingUserId}
          onClose={closeCompose}
          onStartDirect={openDirect}
          onStartTarget={(id) => {
            const next = new URLSearchParams()
            if (unreadOnly) next.set('unread', 'true')
            if (!user?.company && companyId) next.set('company', companyId)
            next.set('to', id)
            navigate(`/messages?${next}`)
          }}
          onOpenGroup={openGroup}
        />
      )}
      {groupOpen && companyId && (
        <NewGroupDrawer
          companyId={companyId}
          onClose={closeGroup}
          onCreated={(id) => {
            closeGroup()
            void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
            navigate(`/messages/${id}`)
          }}
        />
      )}
      {infoOpen && detail.data && user && (
        <ThreadInfoDrawer
          thread={detail.data}
          currentUserId={user.id}
          onClose={() => setInfoOpen(false)}
          onLeft={() => {
            setInfoOpen(false)
            navigate('/messages')
          }}
        />
      )}
      {forwarding && (
        <ForwardMessageDrawer
          message={forwarding}
          companyScope={threadCompanyScope}
          currentThreadId={threadId ?? ''}
          onClose={() => setForwarding(null)}
          onForwarded={(targetThreadId) => {
            setForwarding(null)
            void client.invalidateQueries({ queryKey: messageKeys.all })
            navigate(`/messages/${targetThreadId}`)
          }}
        />
      )}
    </div>
  )
}
