import type { ChatMessageView } from '@lankadws/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStream } from './MessageStream'
import { MemoryRouter } from 'react-router-dom'

function message(): ChatMessageView {
  return {
    id: 'message-1',
    authorId: 'user-1',
    body: 'Вітаю',
    createdAt: '2026-09-08T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    version: 1,
    replyToId: null,
    mentions: [],
    replyPreview: null,
    author: { id: 'user-1', displayName: 'Марія', avatarAsset: null },
    attachments: [],
    readByCount: 0,
    reactions: { likeCount: 0, likedByMe: false },
    canEdit: true,
    canDelete: true,
  }
}

function renderStream(onLoadOlder = vi.fn(async () => undefined)) {
  const rendered = render(
    <MessageStream
      threadId="thread-1"
      messages={[message()]}
      currentUserId="user-1"
      lastReadMessageId={null}
      canLoadOlder
      loadingOlder={false}
      onLoadOlder={onLoadOlder}
      onReply={vi.fn()}
      onLike={vi.fn()}
      onForward={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  const stream = rendered.container.querySelector('.message-stream') as HTMLDivElement
  Object.defineProperties(stream, {
    clientHeight: { configurable: true, get: () => 300 },
    scrollHeight: { configurable: true, get: () => 1_000 },
    scrollTop: { configurable: true, writable: true, value: -200 },
  })
  return { stream, onLoadOlder }
}

describe('MessageStream history pagination', () => {
  it('shows the author only on the oldest message in a consecutive run and restarts after another author or day', () => {
    const incoming = (id: string, authorId: string, createdAt: string): ChatMessageView => ({
      ...message(), id, authorId, createdAt,
      author: { id: authorId, displayName: authorId, avatarAsset: null },
    })
    const { container } = render(<MemoryRouter><MessageStream
      threadId="thread-grouping"
      messages={[
        incoming('next-day', 'maria', '2026-09-09T10:00:00Z'),
        incoming('return', 'maria', '2026-09-08T10:04:00Z'),
        incoming('other', 'andrii', '2026-09-08T10:03:00Z'),
        incoming('last', 'maria', '2026-09-08T10:02:00Z'),
        incoming('first', 'maria', '2026-09-08T10:01:00Z'),
      ]}
      currentUserId="viewer" lastReadMessageId={null} canLoadOlder={false} loadingOlder={false}
      onLoadOlder={vi.fn()} onReply={vi.fn()} onLike={vi.fn()} onForward={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()}
    /></MemoryRouter>)
    expect(container.querySelector('#message-last .message-bubble__author')).toBeNull()
    expect(container.querySelector('#message-first a.message-author-avatar')).toBeNull()
    expect(container.querySelector('#message-first .message-author-avatar')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('#message-last a.message-author-avatar')).not.toBeNull()
    for (const id of ['first', 'other', 'return', 'next-day']) {
      expect(container.querySelector(`#message-${id} .message-bubble__author`)).not.toBeNull()
    }
  })

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollTo?: typeof HTMLElement.prototype.scrollTo }).scrollTo
  })

  it('does not load older history until the user scrolls upward', () => {
    const { stream, onLoadOlder } = renderStream()

    fireEvent.scroll(stream)

    expect(onLoadOlder).not.toHaveBeenCalled()
  })

  it('does not treat the click that opens a chat as an upward scroll', () => {
    const { stream, onLoadOlder } = renderStream()

    fireEvent.pointerDown(stream, { clientY: 200 })
    stream.scrollTop = -700
    fireEvent.scroll(stream)

    expect(onLoadOlder).not.toHaveBeenCalled()
  })

  it('does not render an unread separator in the message stream', () => {
    renderStream()

    expect(screen.queryByText('Непрочитані')).not.toBeInTheDocument()
  })

  it('loads one older page after the user reaches the top while scrolling upward', () => {
    const { stream, onLoadOlder } = renderStream()

    fireEvent.wheel(stream, { deltaY: -50 })
    stream.scrollTop = -700
    fireEvent.scroll(stream)

    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
})
