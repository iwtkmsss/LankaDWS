import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, jsonBody } from '../../shared/api/client'
import { useDocumentVisible } from '../../shared/lib/useDocumentVisible'

let visibleOpenTasks = 0

/** True while a loaded task is on screen and will read its own notifications when it reloads. */
export function hasVisibleOpenTask(): boolean {
  return visibleOpenTasks > 0
}

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
    mutationFn: (before: number) => api<{ updated: number }>('/notifications/read-entity', {
      method: 'PATCH',
      body: jsonBody({ entityType, entityId, before: new Date(before).toISOString(), loadedAgoMs: Math.max(0, Date.now() - before) }),
    }),
    retry: 2,
    onSettled: (result) => {
      // An open task always refreshes: the realtime hook leaves the counters to
      // this read. Not for feed cards, whose read reruns whenever the feed reloads.
      if (!result?.updated && entityType !== 'TASK') return
      void client.invalidateQueries({ queryKey: ['notifications'] })
      void client.invalidateQueries({ queryKey: ['feed'] })
    },
  })
  const visibleTask = entityType === 'TASK' && Boolean(entityId) && foreground
  useEffect(() => {
    if (!visibleTask) return
    visibleOpenTasks += 1
    return () => { visibleOpenTasks -= 1 }
  }, [visibleTask])
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
    mutate(loadedAt)
  }, [entityType, entityId, loadedAt, visible, foreground, mutate])
  return element
}
