import { chatRealtimeEventSchema, realtimeSummaryChangedSchema } from '@lankadws/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiUrl } from '../../../shared/api/client'
import { getMessage, getThreadPreview } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
import { upsertMessageCache, upsertThreadPreview } from '../lib/messageCache'
import { notifyMessageSound } from '../lib/messageSound'

export function useMessageRealtime(enabled = true, userId?: string): boolean {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let channelReady = false
    let disposed = false
    const refreshChat = () => Promise.all([
      client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
      client.invalidateQueries({ queryKey: [...messageKeys.all, 'thread'] }),
      client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
      client.invalidateQueries({ queryKey: ['notifications'] }),
      client.invalidateQueries({ queryKey: ['task'] }),
      client.invalidateQueries({ queryKey: ['task-activity'] }),
    ])
    // SSE has no replay. Recover missed events even if the connection is unavailable
    // or a proxy silently stops forwarding events while the tab remains open.
    let fallback: ReturnType<typeof setTimeout>
    const scheduleFallback = () => {
      clearTimeout(fallback)
      fallback = setTimeout(() => {
        if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
          void refreshChat().finally(() => { if (!disposed) scheduleFallback() })
        } else {
          scheduleFallback()
        }
      }, channelReady ? 60_000 : 5_000)
    }
    scheduleFallback()
    const source = typeof EventSource === 'undefined'
      ? null
      : new EventSource(apiUrl('/messages/events'), { withCredentials: true })
    const handledEvents = new Set<string>()
    const handleChat = (rawEvent: Event) => {
      if (!(rawEvent instanceof MessageEvent)) return
      let payload: unknown
      try {
        payload = JSON.parse(rawEvent.data) as unknown
      } catch {
        return
      }
      const parsed = chatRealtimeEventSchema.safeParse(payload)
      if (!parsed.success) return
      const event = parsed.data
      const eventKey = `${event.threadId}:${event.eventType}:${event.messageId ?? ''}:${event.occurredAt}`
      if (handledEvents.has(eventKey)) return
      handledEvents.add(eventKey)
      if (handledEvents.size > 200) {
        const oldest = handledEvents.values().next().value
        if (oldest) handledEvents.delete(oldest)
      }
      if (event.eventType === 'thread.read') {
        void client.invalidateQueries({ queryKey: messageKeys.pages(event.threadId) })
      }
      void Promise.all([
        client.invalidateQueries({ queryKey: messageKeys.detail(event.threadId) }),
        client.invalidateQueries({ queryKey: ['threads', 'summary'] }),
        client.invalidateQueries({ queryKey: ['notifications'] }),
      ])
      void Promise.all([
        event.messageId
          ? getMessage(event.messageId)
              .then((message) => {
                upsertMessageCache(client, event.threadId, message)
                return message
              })
              .catch(() => {
                void client.invalidateQueries({ queryKey: messageKeys.pages(event.threadId) })
                return undefined
              })
          : Promise.resolve(),
        getThreadPreview(event.threadId)
          .then((preview) => {
            upsertThreadPreview(client, preview)
            return preview
          })
          .catch(() => {
            void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
            return undefined
          }),
      ]).then(([message, preview]) => {
        if (!disposed && userId && event.eventType === 'message.created' && message && preview) {
          void notifyMessageSound(userId, event.threadId, message, preview)
        }
      })
    }
    const handleSummary = (rawEvent: Event) => {
      if (!(rawEvent instanceof MessageEvent)) return
      let payload: unknown
      try {
        payload = JSON.parse(rawEvent.data) as unknown
      } catch {
        return
      }
      const parsed = realtimeSummaryChangedSchema.safeParse(payload)
      if (!parsed.success) return
      const invalidations = parsed.data.kinds.flatMap((kind) => {
        if (kind === 'messages') {
          return [client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })]
        }
        if (kind === 'feed') {
          return [
            client.invalidateQueries({ queryKey: ['feed'] }),
            client.invalidateQueries({ queryKey: ['feed', 'summary'] }),
          ]
        }
        return [
          client.invalidateQueries({ queryKey: ['notifications'] }),
          client.invalidateQueries({ queryKey: ['task'] }),
          client.invalidateQueries({ queryKey: ['task-activity'] }),
        ]
      })
      void Promise.all(invalidations)
    }
    source?.addEventListener('ready', () => {
      channelReady = true
      setConnected(true)
      scheduleFallback()
      void refreshChat()
    })
    source?.addEventListener('chat', handleChat)
    source?.addEventListener('summary', handleSummary)
    if (source) source.onerror = () => {
      const wasReady = channelReady
      channelReady = false
      setConnected(false)
      // EventSource can fail every three seconds. Resetting a five-second
      // fallback on every retry would prevent it from ever running.
      if (wasReady) scheduleFallback()
    }
    return () => {
      disposed = true
      clearTimeout(fallback)
      source?.close()
      setConnected(false)
    }
  }, [client, enabled, userId])

  return connected
}
