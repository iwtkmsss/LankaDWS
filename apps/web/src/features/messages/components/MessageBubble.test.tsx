import type { ChatMessageView } from '@lankadws/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from './MessageBubble'
import { OverlayProvider } from '../../../shared/ui'

function message(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'message-1',
    authorId: 'user-1',
    body: '',
    createdAt: '2026-08-31T10:00:00.000Z',
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
    ...overrides,
  }
}

const handlers = {
  onReply: vi.fn(),
  onLike: vi.fn(),
  onForward: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onConvert: vi.fn(),
}

describe('MessageBubble', () => {
  it('shows read status for an own message', () => {
    const { container } = render(
      <MemoryRouter>
        <MessageBubble
          threadId="thread-1"
          message={message({ body: 'Вітаю', readByCount: 1 })}
          own
          canConvertToTask={false}
          canConvertToEvent={false}
          {...handlers}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTitle('Прочитано')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble > .message-bubble__meta')).toBeInTheDocument()
  })

  it('starts a reply when the message is double-clicked', () => {
    const onReply = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble
          threadId="thread-1"
          message={target}
          own
          canConvertToTask={false}
          canConvertToEvent={false}
          {...handlers}
          onReply={onReply}
        />
      </MemoryRouter>,
    )

    fireEvent.doubleClick(screen.getByText('Вітаю'))

    expect(onReply).toHaveBeenCalledWith(target)
  })

  it('marks a newly received message for the current chat session', () => {
    const { container } = render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={message({ body: 'Нове' })} own={false} isNew canConvertToTask={false} canConvertToEvent={false} {...handlers} />
      </MemoryRouter>,
    )

    expect(container.querySelector('.message-row')).toHaveClass('is-new')
  })

  it('raises a like as a reaction on the message', () => {
    const onLike = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own canConvertToTask={false} canConvertToEvent={false} {...handlers} onLike={onLike} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Подобається' }))

    expect(onLike).toHaveBeenCalledWith(target)
  })

  it('shows the like count and offers to withdraw an own reaction', () => {
    const onLike = vi.fn()
    const target = message({ body: 'Вітаю', reactions: { likeCount: 3, likedByMe: true } })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own canConvertToTask={false} canConvertToEvent={false} {...handlers} onLike={onLike} />
      </MemoryRouter>,
    )

    const counter = screen.getAllByRole('button', { name: 'Прибрати вподобання' })[0]
    expect(counter).toHaveTextContent('3')
    fireEvent.click(counter)
    expect(onLike).toHaveBeenCalledWith(target)
  })

  it('offers forwarding from the message actions menu', () => {
    const onForward = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own canConvertToTask={false} canConvertToEvent={false} {...handlers} onForward={onForward} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Переслати' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Дії з повідомленням' }))
    fireEvent.click(screen.getByRole('button', { name: 'Переслати' }))

    expect(onForward).toHaveBeenCalledWith(target)
  })

  it('grows the edit box so a long message is visible without scrolling', () => {
    const target = message({ body: ['перший', 'другий', 'третій', 'четвертий', 'пʼятий'].join('\n') })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MessageBubble threadId="thread-1" message={target} own canConvertToTask={false} canConvertToEvent={false} {...handlers} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Дії з повідомленням' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))

    expect(screen.getByLabelText('Текст повідомлення')).toHaveAttribute('rows', '6')
  })

  it('renders an image preview plus open and download actions for a clean image', () => {
    const { container } = render(
      <MemoryRouter>
        <OverlayProvider>
          <MessageBubble
            threadId="thread-1"
            message={message({
              attachments: [{
                id: 'file-1',
                fileName: 'photo.png',
                bytes: 1024,
                mimeType: 'image/png',
                scanStatus: 'CLEAN',
              }],
            })}
            own
            canConvertToTask={false}
            canConvertToEvent={false}
            {...handlers}
          />
        </OverlayProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/file-1/download?inline=true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути photo.png' }))
    const preview = screen.getByRole('dialog', { name: 'photo.png' })
    expect(within(preview).getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/file-1/download?inline=true',
    )
    fireEvent.click(within(preview).getByRole('button', { name: 'Збільшити' }))
    expect(within(preview).getByRole('button', { name: 'Вмістити зображення у вікно' })).toHaveTextContent('125%')
    expect(screen.getByRole('link', { name: /Завантажити/ })).toHaveAttribute(
      'href',
      '/api/v1/files/file-1/download',
    )
    expect(container.querySelector('.message-bubble__meta .compact-file-name')).toHaveAttribute('title', 'photo.png')
    expect(container.querySelector('.message-attachment__copy > .compact-file-name')).not.toBeInTheDocument()
  })

  it('opens the shared user panel from another author without leaving the thread', () => {
    render(
      <MemoryRouter initialEntries={['/messages/thread-1?unread=true']}>
        <MessageBubble
          threadId="thread-1"
          message={message({ body: 'Вітаю' })}
          own={false}
          canConvertToTask={false}
          canConvertToEvent={false}
          {...handlers}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Відкрити профіль Марія' })).toHaveAttribute(
      'href',
      '/messages/thread-1?unread=true&employeeId=user-1',
    )
  })
})
