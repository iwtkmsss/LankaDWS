import type {
  ChatMessageView,
  ChatThreadPreview,
} from '@lankadws/contracts'
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type InfiniteData,
} from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMessage, getThreadPreview } from './api/messageApi'
import { messageKeys } from './api/messageKeys'
import { useMessageRealtime } from './hooks/useMessageRealtime'
import { notifyMessageSound } from './lib/messageSound'
import { addOptimisticMessage, upsertMessageCache, upsertThreadPreview } from './lib/messageCache'
import { chatCreationCompanyId, chatThreadCompanyScope } from './MessagesPage'

vi.mock('./api/messageApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/messageApi')>()
  return {
    ...actual,
    getMessage: vi.fn(),
    getThreadPreview: vi.fn(),
  }
})

vi.mock('./lib/messageSound', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/messageSound')>(),
  notifyMessageSound: vi.fn(),
}))

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  readonly url: string
  readonly withCredentials: boolean
  onerror: ((event: Event) => void) | null = null

  constructor(url: string | URL, options?: EventSourceInit) {
    super()
    this.url = String(url)
    this.withCredentials = Boolean(options?.withCredentials)
    FakeEventSource.instances.push(this)
  }

  close() {}
}

const message: ChatMessageView = {
  id: 'message-1',
  authorId: 'usr_marko',
  body: 'Оновлення',
  createdAt: '2026-07-28T12:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  version: 1,
  replyToId: null,
  mentions: [],
  replyPreview: null,
  author: {
    id: 'usr_marko',
    displayName: 'Марко Литвин',
    avatarAsset: null,
  },
  attachments: [],
  readByCount: 0,
  reactions: { likeCount: 0, likedByMe: false },
  canEdit: false,
  canDelete: false,
}

const preview: ChatThreadPreview = {
  item: {
    id: 'thread-1',
    companyId: 'company-1',
    title: 'Марко Литвин',
    kind: 'DIRECT',
    avatarAsset: null,
    previewParticipants: [],
    participantCount: 2,
    lastMessageAt: message.createdAt,
    lastMessage: message.body,
    lastMessageId: message.id,
    unread: true,
    unreadCount: 1,
    notificationMode: 'ALL',
  },
  counts: { all: 1, unread: 1 },
}

function RealtimeHarness() {
  useMessageRealtime(true, 'usr_current')
  return null
}

describe('MessagesPage realtime flow', () => {
  it('refreshes both chat lists when personal pins change in another session', async () => {
    const client = new QueryClient()
    const keys = [messageKeys.threads('all', false), messageKeys.threads('company-1', true)]
    for (const key of keys) client.setQueryData(key, { pages: [], pageParams: [] })
    render(<QueryClientProvider client={client}><RealtimeHarness /></QueryClientProvider>)
    await act(async () => {
      FakeEventSource.instances[0]?.dispatchEvent(new MessageEvent('summary', { data: JSON.stringify({
        kinds: ['messages'], occurredAt: '2026-10-14T12:00:00.000Z',
      }) }))
    })
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('retains old pins and the regular page when an incoming preview updates the cache', () => {
    const client = new QueryClient()
    const key = messageKeys.threads('all', false)
    const pins = Array.from({ length: 35 }, (_, index) => ({ ...preview.item, id: `pin-${index}`, pinned: true }))
    const regular = Array.from({ length: 30 }, (_, index) => ({ ...preview.item, id: `chat-${index}`, pinned: false }))
    client.setQueryData(key, { pages: [{ items: [...pins, ...regular], counts: preview.counts, nextCursor: 'cursor' }], pageParams: [null] })
    upsertThreadPreview(client, { ...preview, item: { ...preview.item, pinned: false } })
    const items = client.getQueryData<InfiniteData<{ items: ChatThreadPreview['item'][] }>>(key)?.pages[0]?.items ?? []
    expect(items.filter((item) => item.pinned)).toHaveLength(35)
    expect(items.filter((item) => !item.pinned)).toHaveLength(30)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.mocked(getMessage).mockReset()
    vi.mocked(getThreadPreview).mockReset()
    vi.mocked(notifyMessageSound).mockReset()
    vi.mocked(getMessage).mockResolvedValue(message)
    vi.mocked(getThreadPreview).mockResolvedValue(preview)
  })

  it('uses the global user-scoped SSE and deduplicates repeated server events', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData<InfiniteData<{ items: ChatMessageView[]; olderCursor: null; newerCursor: null }>>(
      messageKeys.pages('thread-1'),
      {
        pageParams: [null],
        pages: [{ items: [], olderCursor: null, newerCursor: null }],
      },
    )

    render(
      <QueryClientProvider client={client}>
        <RealtimeHarness />
      </QueryClientProvider>,
    )

    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe('/api/v1/messages/events')
    expect(source?.url).not.toContain('/threads/')
    expect(source?.withCredentials).toBe(true)

    const payload = JSON.stringify({
      threadId: 'thread-1',
      eventType: 'message.created',
      messageId: 'message-1',
      occurredAt: '2026-07-28T12:00:01.000Z',
    })
    await act(async () => {
      source?.dispatchEvent(new MessageEvent('chat', { data: payload }))
      source?.dispatchEvent(new MessageEvent('chat', { data: payload }))
    })

    await waitFor(() => expect(getMessage).toHaveBeenCalledTimes(1))
    expect(getThreadPreview).toHaveBeenCalledTimes(1)
    const cached = client.getQueryData<InfiniteData<{ items: ChatMessageView[] }>>(
      messageKeys.pages('thread-1'),
    )
    expect(cached?.pages.flatMap((page) => page.items)).toEqual([message])
    await waitFor(() => expect(notifyMessageSound).toHaveBeenCalledExactlyOnceWith(
      'usr_current', 'thread-1', message, preview,
    ))
  })

  it('does not ring for edits, deletes, read markers or thread changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><RealtimeHarness /></QueryClientProvider>)
    await act(async () => {
      for (const eventType of ['message.edited', 'message.deleted', 'thread.read', 'thread.updated']) {
        FakeEventSource.instances[0]?.dispatchEvent(new MessageEvent('chat', { data: JSON.stringify({
          threadId: 'thread-1', eventType, messageId: 'message-1', occurredAt: '2026-10-12T10:00:00.000Z',
        }) }))
      }
    })
    await waitFor(() => expect(getMessage).toHaveBeenCalledTimes(4))
    expect(notifyMessageSound).not.toHaveBeenCalled()
  })

  it('ignores malformed event data without breaking the channel', async () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <RealtimeHarness />
      </QueryClientProvider>,
    )
    const source = FakeEventSource.instances[0]

    await act(async () => {
      source?.dispatchEvent(new MessageEvent('chat', { data: '{broken' }))
    })

    expect(getMessage).not.toHaveBeenCalled()
    expect(getThreadPreview).not.toHaveBeenCalled()
  })

  it('fetches messages missed during a disconnect when SSE becomes ready again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const page = { pages: [{ items: [message], olderCursor: null, newerCursor: null }], pageParams: [null] }
    client.setQueryData(messageKeys.pages('thread-1'), { ...page, pages: [{ ...page.pages[0], items: [] }] })
    const queryFn = vi.fn().mockResolvedValue(page)
    const observer = new QueryObserver(client, {
      queryKey: messageKeys.pages('thread-1'), queryFn, staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    const view = render(<QueryClientProvider client={client}><RealtimeHarness /></QueryClientProvider>)
    const source = FakeEventSource.instances[0]!
    await act(async () => { source.dispatchEvent(new MessageEvent('ready')) })
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    queryFn.mockClear()
    const missedMessage = { ...message, id: 'message-missed', body: 'Після втрати зв’язку' }
    queryFn.mockResolvedValue({ ...page, pages: [{ ...page.pages[0], items: [message, missedMessage] }] })
    await act(async () => {
      source.onerror?.(new Event('error'))
      source.dispatchEvent(new MessageEvent('ready'))
    })
    await waitFor(() => expect(client.getQueryData(messageKeys.pages('thread-1'))).toEqual({
      ...page, pages: [{ ...page.pages[0], items: [message, missedMessage] }],
    }))
    expect(queryFn).toHaveBeenCalledTimes(1)
    unsubscribe()
    view.unmount()
  })

  it.each([true, false])('refreshes chats without a working SSE channel (EventSource available: %s)', async (available) => {
    vi.useFakeTimers()
    if (!available) vi.stubGlobal('EventSource', undefined)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const view = render(<QueryClientProvider client={client}><RealtimeHarness /></QueryClientProvider>)
    if (available) {
      await act(async () => { FakeEventSource.instances[0]!.onerror?.(new Event('error')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      await act(async () => { FakeEventSource.instances[0]!.onerror?.(new Event('error')) })
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(available ? 2_000 : 5_000) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'thread'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'threads'] })
    invalidate.mockClear()
    view.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('retries through chat queries when point reads fail', async () => {
    vi.mocked(getMessage).mockRejectedValue(new Error('Temporary failure'))
    vi.mocked(getThreadPreview).mockRejectedValue(new Error('Temporary failure'))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(<QueryClientProvider client={client}><RealtimeHarness /></QueryClientProvider>)
    await act(async () => {
      FakeEventSource.instances[0]!.dispatchEvent(new MessageEvent('chat', { data: JSON.stringify({
        threadId: 'thread-1', eventType: 'message.created', messageId: message.id, occurredAt: message.createdAt,
      }) }))
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messageKeys.pages('thread-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'threads'] })
  })

  it('invalidates message pages when another participant reads the thread', async () => {
    const client = new QueryClient()
    client.setQueryData(messageKeys.pages('thread-1'), { pages: [], pageParams: [] })
    render(
      <QueryClientProvider client={client}>
        <RealtimeHarness />
      </QueryClientProvider>,
    )
    const source = FakeEventSource.instances[0]

    await act(async () => {
      source?.dispatchEvent(new MessageEvent('chat', { data: JSON.stringify({
        threadId: 'thread-1',
        eventType: 'thread.read',
        messageId: null,
        occurredAt: '2026-07-28T12:01:00.000Z',
      }) }))
    })

    expect(client.getQueryState(messageKeys.pages('thread-1'))?.isInvalidated).toBe(true)
  })

  it('refreshes feed and notification data only when the server reports a changed summary', async () => {
    const client = new QueryClient()
    client.setQueryData(['feed', 'summary', 'company-1'], { unreadCount: 1 })
    client.setQueryData(['notifications', 'summary'], { unread: 1, action: 0 })
    render(
      <QueryClientProvider client={client}>
        <RealtimeHarness />
      </QueryClientProvider>,
    )
    const source = FakeEventSource.instances[0]

    await act(async () => {
      source?.dispatchEvent(new MessageEvent('summary', { data: JSON.stringify({
        kinds: ['feed', 'notifications'],
        occurredAt: '2026-07-28T12:01:00.000Z',
      }) }))
    })

    expect(client.getQueryState(['feed', 'summary', 'company-1'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['notifications', 'summary'])?.isInvalidated).toBe(true)
  })

  it('reconciles an own optimistic row when SSE wins the response race', () => {
    const client = new QueryClient()
    const optimistic = {
      ...message,
      id: 'optimistic:send-1',
      createdAt: '2026-07-28T12:00:00.500Z',
    }
    addOptimisticMessage(client, 'thread-1', optimistic)

    upsertMessageCache(client, 'thread-1', message)
    upsertMessageCache(client, 'thread-1', message, optimistic.id)

    const cached = client.getQueryData<InfiniteData<{ items: ChatMessageView[] }>>(
      messageKeys.pages('thread-1'),
    )
    expect(cached?.pages.flatMap((page) => page.items)).toEqual([message])
  })
})

describe('MessagesPage company scope', () => {
  it('loads all permitted thread companies for a global admin without a primary company', () => {
    expect(chatThreadCompanyScope({ accountType: 'ADMIN', company: null })).toBe('all')
  })

  it('loads all workspace threads for an organization user', () => {
    expect(chatThreadCompanyScope({
      accountType: 'USER',
      company: { id: 'company-1' },
    })).toBe('all')
  })

  it('selects an active company for chat creation by a global admin', () => {
    const admin = { accountType: 'ADMIN' as const, company: null }
    const companies = [
      { id: 'company-1', name: 'Перша', isActive: true },
      { id: 'company-2', name: 'Друга', isActive: true },
      { id: 'company-3', name: 'Архівна', isActive: false },
    ]

    expect(chatCreationCompanyId(admin, null, companies)).toBe('company-1')
    expect(chatCreationCompanyId(admin, 'company-2', companies)).toBe('company-2')
    expect(chatCreationCompanyId(admin, 'company-3', companies)).toBe('company-1')
  })
})
