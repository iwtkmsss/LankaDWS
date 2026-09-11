import type { ChatMessageView } from '@lankadws/contracts'
import { describe, expect, it } from 'vitest'
import { replyPreviewText } from './replyPreview'

function message(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'message-1',
    authorId: 'user-1',
    body: '',
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
    ...overrides,
  }
}

describe('replyPreviewText', () => {
  it('uses Фото when a message contains an image, even with a description', () => {
    expect(replyPreviewText(message({
      body: 'Опис фото',
      attachments: [{
        id: 'file-1',
        fileName: 'photo.png',
        bytes: 1_024,
        mimeType: 'image/png',
        scanStatus: 'CLEAN',
      }],
    }))).toBe('Фото')
  })

  it('compacts a text-only preview', () => {
    expect(replyPreviewText(message({ body: '  Короткий\n   текст  ' }))).toBe('Короткий текст')
  })
})
