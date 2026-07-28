export interface ChatThreadCursor {
  lastMessageAt: string | null
  createdAt: string
  id: string
}

export interface ChatMessageCursor {
  createdAt: string
  id: string
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decode(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
}

export function encodeChatThreadCursor(input: {
  lastMessageAt: Date | null
  createdAt: Date
  id: string
}): string {
  return encode({
    lastMessageAt: input.lastMessageAt?.toISOString() ?? null,
    createdAt: input.createdAt.toISOString(),
    id: input.id,
  } satisfies ChatThreadCursor)
}

export function decodeChatThreadCursor(value: string): ChatThreadCursor {
  const parsed = decode(value) as Partial<ChatThreadCursor>
  if (
    typeof parsed.id !== 'string'
    || !parsed.id
    || typeof parsed.createdAt !== 'string'
    || Number.isNaN(Date.parse(parsed.createdAt))
    || (
      parsed.lastMessageAt !== null
      && (
        typeof parsed.lastMessageAt !== 'string'
        || Number.isNaN(Date.parse(parsed.lastMessageAt))
      )
    )
  ) throw new Error('invalid chat thread cursor')
  return {
    id: parsed.id,
    createdAt: parsed.createdAt,
    lastMessageAt: parsed.lastMessageAt ?? null,
  }
}

export function encodeChatMessageCursor(input: {
  createdAt: Date
  id: string
}): string {
  return encode({
    createdAt: input.createdAt.toISOString(),
    id: input.id,
  } satisfies ChatMessageCursor)
}

export function decodeChatMessageCursor(value: string): ChatMessageCursor {
  const parsed = decode(value) as Partial<ChatMessageCursor>
  if (
    typeof parsed.id !== 'string'
    || !parsed.id
    || typeof parsed.createdAt !== 'string'
    || Number.isNaN(Date.parse(parsed.createdAt))
  ) throw new Error('invalid chat message cursor')
  return { id: parsed.id, createdAt: parsed.createdAt }
}
