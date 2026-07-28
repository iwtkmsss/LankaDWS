import { chatRealtimeEventSchema } from '@bert-crm/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiUrl } from '../../../shared/api/client'
import { getMessage, getThreadPreview } from '../api/messageApi'
import { upsertMessageCache, upsertThreadPreview } from '../lib/messageCache'

export function useMessageRealtime(): boolean {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
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
    source.addEventListener('ready', () => setConnected(true))
    source.addEventListener('chat', handleChat)
    source.onerror = () => setConnected(false)
    return () => {
      source.close()
      setConnected(false)
    }
  }, [client])

  return connected
}
