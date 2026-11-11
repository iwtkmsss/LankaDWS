import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../../shared/api/client'
import { formatCount } from '../../shared/lib/format'
import './notification-read-state.css'

/** Unread notifications per task, sharing the right panel's cached unread list. */
export function useUnreadTaskCounts(): ReadonlyMap<string, number> {
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ items: Array<{ entityType?: string | null; entityId?: string | null }> }>('/notifications?tab=unread'),
  })
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of unread.data?.items ?? []) {
      if (item.entityType === 'TASK' && item.entityId) counts.set(item.entityId, (counts.get(item.entityId) ?? 0) + 1)
    }
    return counts
  }, [unread.data])
}

export function TaskUnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <b className="task-unread-badge" aria-label={`Непрочитаних оновлень: ${count}`}>
      Нове{count > 1 ? ` · ${formatCount(count)}` : ''}
    </b>
  )
}
