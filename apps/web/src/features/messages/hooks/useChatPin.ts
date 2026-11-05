import { useIsMutating, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { ChatThreadPage } from '@lankadws/contracts'
import { api, jsonBody } from '../../../shared/api/client'
import { messageKeys } from '../api/messageKeys'

const mutationKey = [...messageKeys.all, 'pin']

export function useChatPin() {
  const client = useQueryClient()
  const pending = useIsMutating({ mutationKey }) > 0
  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ threadId, pinned }: { threadId: string; pinned: boolean }) =>
      api<{ pinned: boolean }>(`/messages/threads/${encodeURIComponent(threadId)}/pin`, {
        method: 'PUT', body: jsonBody({ pinned }),
      }),
    onSuccess: ({ pinned }, { threadId }) => {
      client.setQueriesData<InfiniteData<ChatThreadPage>>(
        { queryKey: [...messageKeys.all, 'threads'] },
        (current) => current ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page, items: page.items.map((item) => item.id === threadId ? { ...item, pinned } : item),
          })),
        } : current,
      )
      void client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] })
    },
  })
  return {
    pending,
    error: mutation.isError,
    toggle: (threadId: string, pinned: boolean) => mutation.mutate({ threadId, pinned }),
  }
}
