import type { ChatMessageView } from '@lankadws/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStream } from './MessageStream'

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
