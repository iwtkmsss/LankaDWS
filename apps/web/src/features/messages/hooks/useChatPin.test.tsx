import { QueryClient, QueryClientProvider, useQuery, type InfiniteData } from '@tanstack/react-query'
import type { ChatThreadPage } from '@lankadws/contracts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import * as apiClient from '../../../shared/api/client'
import { messageKeys } from '../api/messageKeys'
import { useChatPin } from './useChatPin'

afterEach(() => vi.restoreAllMocks())

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const keys = [messageKeys.threads('all', false), messageKeys.threads('company', true)]
  for (const key of keys) client.setQueryData(key, {
    pages: [{ items: [{ id: 'thread', pinned: false }] }], pageParams: [null],
  })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hooks = keys.map((key) => renderHook(() => ({
    pin: useChatPin(),
    data: useQuery<InfiniteData<ChatThreadPage>>({ queryKey: key, enabled: false }).data,
  }), { wrapper }))
  return { client, hooks }
}

describe('shared chat pins', () => {
  it('updates both mounted chat lists and shares pending state', async () => {
    let resolve!: (value: { pinned: boolean }) => void
    const request = vi.spyOn(apiClient, 'api').mockImplementation(() => new Promise((done) => { resolve = done }))
    const { hooks } = setup()
    act(() => hooks[0]!.result.current.pin.toggle('thread', true))
    await waitFor(() => expect(hooks[1]!.result.current.pin.pending).toBe(true))
    await act(async () => resolve({ pinned: true }))
    await waitFor(() => {
      for (const hook of hooks) expect(hook.result.current.data?.pages[0]?.items[0]?.pinned).toBe(true)
    })
    expect(request).toHaveBeenCalledWith('/messages/threads/thread/pin', { method: 'PUT', body: '{"pinned":true}' })
  })

  it('leaves both lists unchanged when saving fails', async () => {
    vi.spyOn(apiClient, 'api').mockRejectedValue(new Error('offline'))
    const { hooks } = setup()
    act(() => hooks[0]!.result.current.pin.toggle('thread', true))
    await waitFor(() => expect(hooks[0]!.result.current.pin.error).toBe(true))
    for (const hook of hooks) expect(hook.result.current.data?.pages[0]?.items[0]?.pinned).toBe(false)
  })
})
