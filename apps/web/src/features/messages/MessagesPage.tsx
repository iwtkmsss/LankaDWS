import { OrganizationCapability } from '@bert-crm/contracts'
import type {
  ChatAttachmentView,
  ChatContactUser,
  ChatMessagePage,
  ChatMessageView,
  StructuredMentionInput,
} from '@bert-crm/contracts'
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
import { api, ApiProblem, jsonBody } from '../../shared/api/client'
import { useAuth } from '../../shared/auth/AuthProvider'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui'
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
  uploadMessageAttachment,
} from './api/messageApi'
import { messageKeys } from './api/messageKeys'
import { ConversationPane } from './components/ConversationPane'
import { DirectDraftPane } from './components/DirectDraftPane'
import { MessageConversionDrawer } from './components/MessageConversionDrawer'
import { MessagesSidebar } from './components/MessagesSidebar'
import { NewChatDrawer } from './components/NewChatDrawer'
import { NewGroupDrawer } from './components/NewGroupDrawer'
import { ThreadInfoDrawer } from './components/ThreadInfoDrawer'
import { useMessageRealtime } from './hooks/useMessageRealtime'
import {
  addOptimisticMessage,
  removeMessageCache,
  upsertMessageCache,
} from './lib/messageCache'
import { normalizedCodePointLength } from './lib/messageText'
import './messages.css'

function visibleApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiProblem)) return fallback
  const reason = error.problem.detail?.trim() || error.problem.title
  return `${fallback} ${reason} Код: ${error.problem.code}. Запит: ${error.problem.correlationId}.`
}

export function MessagesPage() {
  const { threadId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { user, canUseCapability } = useAuth()
  const companyId = user?.company?.id ?? ''
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
  const [composerError, setComposerError] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftError, setDraftError] = useState('')
  const [composerSeed, setComposerSeed] = useState<{ threadId: string; body: string } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [conversion, setConversion] = useState<{
    kind: 'task' | 'event'
    message: ChatMessageView
  } | null>(null)
  const markedReadRef = useRef('')
  const directAttemptRef = useRef({ userId: '', key: '' })
  const directStartingRef = useRef('')
  const sendAttemptRef = useRef({ signature: '', key: '', tempId: '' })
  const draftBodyRef = useRef('')
  const realtimeConnected = useMessageRealtime()

  useEffect(() => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (query) next.set('q', query)
      else next.delete('q')
      return next
    }, { replace: true })
  }, [query, setParams])

  const threadPages = useInfiniteQuery({
    queryKey: messageKeys.threads(companyId, unreadOnly),
    queryFn: ({ pageParam, signal }) =>
      getThreadPage(companyId, unreadOnly, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(companyId),
    refetchInterval: realtimeConnected ? false : 15_000,
    refetchIntervalInBackground: false,
  })
  const threads = threadPages.data?.pages.flatMap((page) => page.items) ?? []
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
    refetchInterval: realtimeConnected ? false : 15_000,
    refetchIntervalInBackground: false,
  })
  const messages = useMemo(
    () => messagePages.data?.pages.slice().reverse().flatMap((page) => page.items) ?? [],
    [messagePages.data],
  )
  const selectedPreview = threads.find((thread) => thread.id === threadId)

  const direct = useMutation({
    mutationFn: async (contact: ChatContactUser) => {
      setStartingUserId(contact.id)
      if (directAttemptRef.current.userId !== contact.id) {
        directAttemptRef.current = {
          userId: contact.id,
          key: `chat-direct:${crypto.randomUUID()}`,
        }
      }
      return createThread({
        companyId,
        kind: 'DIRECT',
        participantIds: [contact.id],
      }, directAttemptRef.current.key)
    },
    onSuccess: (thread) => {
      directStartingRef.current = ''
      directAttemptRef.current = { userId: '', key: '' }
      setStartingUserId(null)
      setQuery('')
      setDraftError('')
      setComposerSeed({ threadId: thread.id, body: draftBodyRef.current })
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
      navigate(`/messages/${thread.id}`)
    },
    onError: (error) => {
      directStartingRef.current = ''
      setStartingUserId(null)
      setDraftError(visibleApiError(error, 'Не вдалося зберегти чат.'))
    },
  })

  useEffect(() => {
    const existingThreadId = targetContact.data?.directThreadId
    if (targetUserId && existingThreadId) navigate(`/messages/${existingThreadId}`, { replace: true })
  }, [navigate, targetContact.data?.directThreadId, targetUserId])

  useEffect(() => {
    draftBodyRef.current = ''
    setDraftBody('')
    setDraftError('')
    directAttemptRef.current = { userId: '', key: '' }
    directStartingRef.current = ''
    direct.reset()
  }, [targetUserId])

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
      setComposerError('')
      sendAttemptRef.current = { signature: '', key: '', tempId: '' }
      await client.invalidateQueries({ queryKey: messageKeys.detail(threadId!) })
    },
    onError: (error, input) => {
      removeMessageCache(client, threadId!, input.tempId)
      setComposerError(visibleApiError(error, 'Не вдалося надіслати. Текст збережено, можна повторити.'))
    },
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results = await Promise.allSettled(
        files.map((file) => uploadMessageAttachment(threadId!, file)),
      )
      return {
        uploaded: results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
        failed: results.filter((result) => result.status === 'rejected').length,
      }
    },
    onSuccess: ({ uploaded, failed }) => {
      setAttachments((current) => [...current, ...uploaded].slice(0, 5))
      setComposerError(failed ? `Не вдалося додати ${failed} файл(и). Перевірте формат і розмір.` : '')
    },
    onError: () => setComposerError('Не вдалося додати файл. Спробуйте ще раз.'),
  })

  const markRead = useMutation({
    mutationFn: (messageId: string) => api(`/messages/threads/${threadId}/read`, {
      method: 'POST',
      body: jsonBody({ lastReadMessageId: messageId }),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: messageKeys.detail(threadId!) })
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
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
    setAttachments([])
    setComposerError('')
    setHighlightedMessageId(null)
    setInfoOpen(false)
    setConversion(null)
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
        key: `chat-message:${crypto.randomUUID()}`,
        tempId: `optimistic:${crypto.randomUUID()}`,
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
        body: replyTo.body.slice(0, 180),
      } : null,
      author: {
        id: user.id,
        displayName: user.displayName,
        avatarAsset: user.avatarAsset,
      },
      attachments,
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

  function openDirect(contact: ChatContactUser) {
    setQuery('')
    if (contact.directThreadId) {
      navigate(`/messages/${contact.directThreadId}`)
      return
    }
    const next = new URLSearchParams()
    if (unreadOnly) next.set('unread', 'true')
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

  function openCompose() {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('new', '1')
      next.delete('to')
      return next
    })
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

  const canConvertToTask = true
  const canConvertToEvent = canUseCapability(OrganizationCapability.CalendarWrite)
    && canUseCapability(OrganizationCapability.CalendarWrite)

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
        onOpenCompose={openCompose}
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
          canConvertToTask={canConvertToTask}
          canConvertToEvent={canConvertToEvent}
          replyTo={replyTo}
          attachments={attachments}
          sending={send.isPending}
          uploading={upload.isPending}
          composerError={composerError}
          initialComposerBody={composerSeed?.threadId === threadId ? composerSeed.body : undefined}
          onInitialComposerBodyConsumed={() => setComposerSeed(null)}
          onBack={() => navigate(`/messages?${params}`)}
          onInfo={() => setInfoOpen(true)}
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
          onReplyCancel={() => setReplyTo(null)}
          onEdit={editMessage}
          onDelete={deleteMessage}
          onConvert={(kind, message) => setConversion({ kind, message })}
          onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          onFiles={(files) => upload.mutate(files)}
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
            error={draftError}
            onBack={() => navigate('/messages')}
            onBodyChange={(value) => {
              draftBodyRef.current = value
              setDraftBody(value)
              if (value.trim() && !directStartingRef.current && !direct.isSuccess) {
                directStartingRef.current = targetContact.data.id
                direct.mutate(targetContact.data)
              }
            }}
            onRetry={() => {
              if (directStartingRef.current) return
              directStartingRef.current = targetContact.data.id
              direct.mutate(targetContact.data)
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
      {conversion && detail.data && user && (
        <MessageConversionDrawer
          kind={conversion.kind}
          message={conversion.message}
          thread={detail.data}
          currentUserId={user.id}
          onClose={() => setConversion(null)}
        />
      )}
    </div>
  )
}
