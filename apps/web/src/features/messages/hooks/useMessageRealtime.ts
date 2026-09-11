import { chatRealtimeEventSchema, realtimeSummaryChangedSchema } from '@lankadws/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiUrl } from '../../../shared/api/client'
import { getMessage, getThreadPreview } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
import { upsertMessageCache, upsertThreadPreview } from '../lib/messageCache'

export function useMessageRealtime(enabled = true): boolean {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource(apiUrl('/messages/events'), { withCredentials: true })
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
      const eventKey = `${event.eventType}:${event.messageId ?? ''}:${event.occurredAt}`
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
              .then((message) => upsertMessageCache(client, event.threadId, message))
              .catch(() => undefined)
          : Promise.resolve(),
        getThreadPreview(event.threadId)
          .then((preview) => upsertThreadPreview(client, preview))
          .catch(() => undefined),
      ])
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
        if (kind === 'feed') {
          return [
            client.invalidateQueries({ queryKey: ['feed'] }),
            client.invalidateQueries({ queryKey: ['feed', 'summary'] }),
          ]
        }
        return [client.invalidateQueries({ queryKey: ['notifications'] })]
      })
      void Promise.all(invalidations)
    }
    source.addEventListener('ready', () => setConnected(true))
    source.addEventListener('chat', handleChat)
    source.addEventListener('summary', handleSummary)
    source.onerror = () => setConnected(false)
    return () => {
      source.close()
      setConnected(false)
    }
  }, [client, enabled])

  return connected
}
