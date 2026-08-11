import type {
  ChatMessageView,
  ChatThreadPreview,
} from '@bert-crm/contracts'
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMessage, getThreadPreview } from './api/messageApi'
import { messageKeys } from './api/messageKeys'
import { useMessageRealtime } from './hooks/useMessageRealtime'
import { addOptimisticMessage, upsertMessageCache } from './lib/messageCache'

vi.mock('./api/messageApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/messageApi')>()
  return {
    ...actual,
    getMessage: vi.fn(),
    getThreadPreview: vi.fn(),
  }
})

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
  useMessageRealtime()
  return null
}

describe('MessagesPage realtime flow', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.mocked(getMessage).mockReset()
    vi.mocked(getThreadPreview).mockReset()
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
