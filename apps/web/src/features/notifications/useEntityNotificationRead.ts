import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, jsonBody } from '../../shared/api/client'
import { useDocumentVisible } from '../../shared/lib/useDocumentVisible'

export function useEntityNotificationRead(
  entityType: 'TASK' | 'FEED_POST' | 'USER' | 'MESSAGE_THREAD',
  entityId: string | undefined,
  loadedAt: number,
  observeVisibility = false,
) {
  const client = useQueryClient()
  const element = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(!observeVisibility)
  const foreground = useDocumentVisible()
  const marked = useRef('')
  const { mutate } = useMutation({
    mutationFn: (before: string) => api<{ updated: number }>('/notifications/read-entity', {
      method: 'PATCH', body: jsonBody({ entityType, entityId, before }),
    }),
    retry: 2,
    onSuccess: (result) => {
      if (result.updated) void client.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  useEffect(() => {
    if (!observeVisibility || !element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)))
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [observeVisibility])
  useEffect(() => {
    if (!entityId || !loadedAt || !visible || !foreground) return
    const marker = `${entityType}:${entityId}:${loadedAt}`
    if (marked.current === marker) return
    marked.current = marker
    mutate(new Date(loadedAt).toISOString())
  }, [entityType, entityId, loadedAt, visible, foreground, mutate])
  return element
}
