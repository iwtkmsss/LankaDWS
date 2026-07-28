import { describe, expect, it } from 'vitest'
import {
  decodeChatMessageCursor,
  decodeChatThreadCursor,
  encodeChatMessageCursor,
  encodeChatThreadCursor,
} from './chat-cursors.js'

describe('chat keyset cursors', () => {
  it('round-trips thread and message sort tuples', () => {
    const thread = {
      lastMessageAt: new Date('2026-07-28T10:00:00.000Z'),
      createdAt: new Date('2026-07-20T09:00:00.000Z'),
      id: 'thread-b',
    }
    expect(decodeChatThreadCursor(encodeChatThreadCursor(thread))).toEqual({
      lastMessageAt: thread.lastMessageAt.toISOString(),
      createdAt: thread.createdAt.toISOString(),
      id: thread.id,
    })

    const message = {
      createdAt: new Date('2026-07-28T10:00:00.000Z'),
      id: 'message-b',
    }
    expect(decodeChatMessageCursor(encodeChatMessageCursor(message))).toEqual({
      createdAt: message.createdAt.toISOString(),
      id: message.id,
    })
  })

  it('preserves null last-message ordering and rejects malformed input', () => {
    const encoded = encodeChatThreadCursor({
      lastMessageAt: null,
      createdAt: new Date('2026-07-20T09:00:00.000Z'),
      id: 'thread-empty',
    })
    expect(decodeChatThreadCursor(encoded).lastMessageAt).toBeNull()
    expect(() => decodeChatThreadCursor('not-a-cursor')).toThrow()
    expect(() => decodeChatMessageCursor(
      Buffer.from(JSON.stringify({ createdAt: 'invalid', id: 'message' })).toString('base64url'),
    )).toThrow()
  })
})
