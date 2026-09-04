import type { ChatMessageView } from '@bert-crm/contracts'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from './MessageBubble'

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
    canEdit: true,
    canDelete: true,
    ...overrides,
  }
}

const handlers = {
  onReply: vi.fn(),
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
    expect(container.querySelector('.message-bubble__content > .message-bubble__meta')).toBeInTheDocument()
  })

  it('renders an image preview plus open and download actions for a clean image', () => {
    const { container } = render(
      <MemoryRouter>
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
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/file-1/download?inline=true',
    )
    expect(screen.getAllByRole('link', { name: /Відкрити/ }).length).toBeGreaterThan(0)
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
