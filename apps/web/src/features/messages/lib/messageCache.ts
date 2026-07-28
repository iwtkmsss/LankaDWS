import type { ChatMessagePage, ChatMessageView, ChatThreadPage, ChatThreadPreview } from '@bert-crm/contracts'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { messageKeys } from '../api/messageKeys'

function isMatchingOptimisticMessage(
  candidate: ChatMessageView,
  serverMessage: ChatMessageView,
): boolean {
  if (!candidate.id.startsWith('optimistic:') || serverMessage.id.startsWith('optimistic:')) {
    return false
  }
  const candidateCreatedAt = Date.parse(candidate.createdAt)
  const serverCreatedAt = Date.parse(serverMessage.createdAt)
  return candidate.authorId === serverMessage.authorId
    && candidate.body === serverMessage.body
    && candidate.replyToId === serverMessage.replyToId
    && candidate.attachments.map((attachment) => attachment.id).join(':')
      === serverMessage.attachments.map((attachment) => attachment.id).join(':')
    && Number.isFinite(candidateCreatedAt)
    && Number.isFinite(serverCreatedAt)
    && Math.abs(candidateCreatedAt - serverCreatedAt) < 120_000
}

export function upsertMessageCache(
  client: QueryClient,
  threadId: string,
  message: ChatMessageView,
  replaceId?: string,
): void {
  client.setQueryData<InfiniteData<ChatMessagePage>>(
    messageKeys.pages(threadId),
    (current) => {
      if (!current?.pages.length) return current
      let found = false
      let reconciledOptimistic = false
      const pages = current.pages.map((page) => ({
        ...page,
        items: page.items.flatMap((item) => {
          if (item.id === replaceId && item.id !== message.id) return []
          if (
            !replaceId
            && !reconciledOptimistic
            && isMatchingOptimisticMessage(item, message)
          ) {
            reconciledOptimistic = true
            return []
          }
          if (item.id !== message.id) return [item]
          found = true
          return [message]
        }),
      }))
      if (!found) pages[0] = { ...pages[0]!, items: [...pages[0]!.items, message] }
      return { ...current, pages }
    },
  )
}

export function addOptimisticMessage(
  client: QueryClient,
  threadId: string,
  message: ChatMessageView,
): void {
  client.setQueryData<InfiniteData<ChatMessagePage>>(
    messageKeys.pages(threadId),
    (current) => {
      if (!current?.pages.length) {
        return {
          pageParams: [null],
          pages: [{ items: [message], olderCursor: null, newerCursor: null }],
        }
      }
      const [first, ...rest] = current.pages
      return {
        ...current,
        pages: [{ ...first!, items: [...first!.items, message] }, ...rest],
      }
    },
  )
}

export function removeMessageCache(
  client: QueryClient,
  threadId: string,
  messageId: string,
): void {
  client.setQueryData<InfiniteData<ChatMessagePage>>(
    messageKeys.pages(threadId),
    (current) => current ? {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.filter((message) => message.id !== messageId),
      })),
    } : current,
  )
}

export function upsertThreadPreview(
  client: QueryClient,
  preview: ChatThreadPreview,
): void {
  client.setQueriesData<InfiniteData<ChatThreadPage>>(
    { queryKey: [...messageKeys.all, 'threads'] },
    (current) => {
      if (!current?.pages.length) return current
      let found = false
      const pages = current.pages.map((page) => ({
        ...page,
        counts: preview.counts,
        items: page.items.map((item) => {
          if (item.id !== preview.item.id) return item
          found = true
          return preview.item
        }),
      }))
      if (!found) pages[0] = {
        ...pages[0]!,
        items: [preview.item, ...pages[0]!.items].slice(0, 30),
      }
      pages[0] = {
        ...pages[0]!,
        items: [...pages[0]!.items].sort((left, right) =>
          (right.lastMessageAt ?? '').localeCompare(left.lastMessageAt ?? '')
          || right.id.localeCompare(left.id),
        ),
      }
      return { ...current, pages }
    },
  )
}
