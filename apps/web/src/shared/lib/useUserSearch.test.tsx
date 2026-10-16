import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState, type PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSearch } from './useUserSearch'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/client', () => ({ api: request }))
beforeEach(() => { request.mockReset() })

function wrapper({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('shared user search hook', () => {
  it('waits for the first character and IME completion', async () => {
    request.mockResolvedValue({ items: [{ id: 'admin', displayName: 'Адміністратор' }] })
    const { result, rerender } = renderHook(({ query }) => useUserSearch(query), { initialProps: { query: ' ' }, wrapper })
    expect(result.current.items).toEqual([])
    expect(request).not.toHaveBeenCalled()
    act(() => result.current.onCompositionStart())
    rerender({ query: 'А' })
    expect(result.current.searching).toBe(false)
    expect(request).not.toHaveBeenCalled()
    act(() => result.current.onCompositionEnd())
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(request.mock.calls[0]?.[0]).toBe('/employees?search=%D0%B0&limit=5&accountType=ALL')
  })

  it('aborts a stale query immediately and hides its results before the next debounce completes', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (data: unknown) => void }> = []
    request.mockImplementation((_url, { signal }) => new Promise((resolve) => pending.push({ signal, resolve })))
    const { result, rerender } = renderHook(({ query }) => useUserSearch(query), { initialProps: { query: 'а' }, wrapper })
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ query: 'б' })
    expect(pending[0]!.signal.aborted).toBe(true)
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(pending).toHaveLength(2))
    act(() => pending[1]!.resolve({ items: [{ id: 'b', displayName: 'Богдан' }] }))
    await waitFor(() => expect(result.current.items[0]?.id).toBe('b'))
    act(() => pending[0]!.resolve({ items: [{ id: 'a', displayName: 'Анна' }] }))
    expect(result.current.items.map((user) => user.id)).toEqual(['b'])
    rerender({ query: '' })
    expect(result.current.items).toEqual([])
    expect(request).toHaveBeenCalledTimes(2)
  })
})
