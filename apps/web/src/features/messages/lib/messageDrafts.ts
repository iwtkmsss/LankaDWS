import { structuredMentionInputSchema, type StructuredMentionInput } from '@lankadws/contracts'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

export interface MessageDraft {
  body: string
  mentions: StructuredMentionInput[]
  createdAt: number
}

export type MessageDrafts = Record<string, MessageDraft>
const changedEvent = 'lankadws:message-drafts-changed'
const fallback = new Map<string, string>()
const storageKey = (userId: string) => `lankadws:message-drafts:${userId}`

function snapshot(userId: string): string {
  if (fallback.has(userId)) return fallback.get(userId)!
  try {
    return window.sessionStorage.getItem(storageKey(userId)) ?? '{}'
  } catch {
    return fallback.get(userId) ?? '{}'
  }
}

function parseDrafts(value: string): MessageDrafts {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed).flatMap(([id, draft]) => {
      if (!draft || typeof draft !== 'object'
        || typeof draft.body !== 'string' || !draft.body
        || typeof draft.createdAt !== 'number' || !Number.isFinite(draft.createdAt)) return []
      const mentions = structuredMentionInputSchema.array().safeParse(draft.mentions)
      return [[id, { body: draft.body, createdAt: draft.createdAt, mentions: mentions.success ? mentions.data : [] }]]
    })
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(changedEvent, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(changedEvent, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useMessageDrafts(userId: string): MessageDrafts {
  const getSnapshot = useCallback(() => snapshot(userId), [userId])
  const value = useSyncExternalStore(subscribe, getSnapshot, () => '{}')
  return useMemo(() => parseDrafts(value), [value])
}

export function setMessageDraft(userId: string, threadId: string, body: string, mentions: StructuredMentionInput[] = []): void {
  const before = snapshot(userId)
  const drafts = parseDrafts(before)
  if (body) {
    drafts[threadId] = { body, mentions, createdAt: body.trim() ? drafts[threadId]?.createdAt || Date.now() : 0 }
  } else {
    delete drafts[threadId]
  }
  const next = JSON.stringify(drafts)
  if (next === before) return
  try {
    window.sessionStorage.setItem(storageKey(userId), next)
    fallback.delete(userId)
  } catch {
    // Keep drafts available in memory when browser storage is blocked.
    fallback.set(userId, next)
  }
  window.dispatchEvent(new Event(changedEvent))
}

export function sortThreadsWithDrafts<T extends { id: string; lastMessageAt: string | null; pinned?: boolean }>(threads: T[], drafts: MessageDrafts): T[] {
  const activity = (thread: T) => Math.max(
    thread.lastMessageAt ? Date.parse(thread.lastMessageAt) || 0 : 0,
    drafts[thread.id]?.createdAt ?? 0,
  )
  return threads.toSorted((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1
    if (!drafts[left.id]?.createdAt && !drafts[right.id]?.createdAt) return 0
    return activity(right) - activity(left)
  })
}
