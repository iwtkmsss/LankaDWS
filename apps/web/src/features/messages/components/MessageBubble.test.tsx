import type { ChatMessageView } from '@bert-crm/contracts'
import { render, screen } from '@testing-library/react'
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
    render(
      <MessageBubble
        threadId="thread-1"
        message={message({ readByCount: 1 })}
        own
        canConvertToTask={false}
        canConvertToEvent={false}
        {...handlers}
      />,
    )
    expect(screen.getByTitle('Прочитано')).toBeInTheDocument()
  })

  it('renders an image preview plus open and download actions for a clean image', () => {
    render(
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
      />,
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
  })
})
