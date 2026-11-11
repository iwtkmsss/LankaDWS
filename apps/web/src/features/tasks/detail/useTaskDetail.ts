import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { TaskActivityPage, TaskDetailView } from '@lankadws/contracts'
import { useEntityNotificationRead } from '../../notifications/useEntityNotificationRead'
import { api } from '../../../shared/api/client'
import type { QueryClient } from '@tanstack/react-query'

export function useTaskDetail(id: string) {
  const query = useQuery({
    queryKey: ['task', id],
    queryFn: () => api<TaskDetailView>(`/tasks/${id}`),
  })
  useEntityNotificationRead('TASK', query.isSuccess ? id : undefined, query.dataUpdatedAt)

  const activity = useInfiniteQuery({
    queryKey: ['task-activity', id],
    queryFn: ({ pageParam }) =>
      api<TaskActivityPage>(
        `/tasks/${id}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: query.isSuccess,
  })
  return { query, activity }
}

/** A task change also moves its list row and its history. */
export function refreshTask(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: ['task', id] })
  void client.invalidateQueries({ queryKey: ['tasks'] })
  void client.invalidateQueries({ queryKey: ['task-activity', id] })
}
