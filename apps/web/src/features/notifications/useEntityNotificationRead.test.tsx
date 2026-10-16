import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { useEntityNotificationRead } from './useEntityNotificationRead'

vi.mock('../../shared/api/client', () => ({ api: vi.fn(), jsonBody: JSON.stringify }))
const loadedAt = Date.parse('2026-09-01T10:00:00Z')
let visibilityCallback: IntersectionObserverCallback
class Observer {
  constructor(callback: IntersectionObserverCallback) { visibilityCallback = callback }
  observe() {}
  disconnect() {}
}
function Harness({ id, timestamp = loadedAt, observe = false }: { id?: string; timestamp?: number; observe?: boolean }) {
  const ref = useEntityNotificationRead(observe ? 'FEED_POST' : 'TASK', id, timestamp, observe)
  return <header ref={ref}>Loaded content</header>
}
function view(props: Parameters<typeof Harness>[0]) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <Harness {...props} />
  </QueryClientProvider>)
}
describe('entity notification reads', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.mocked(api).mockResolvedValue({ updated: 1 })
    vi.stubGlobal('IntersectionObserver', Observer)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('waits for successfully loaded entity data and sends the snapshot cutoff', async () => {
    const client = new QueryClient()
    const rendered = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
    expect(api).not.toHaveBeenCalled()
    rendered.rerender(<QueryClientProvider client={client}><Harness id="task-1" /></QueryClientProvider>)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/read-entity', {
      method: 'PATCH', body: JSON.stringify({ entityType: 'TASK', entityId: 'task-1', before: new Date(loadedAt).toISOString() }),
    }))
    rendered.rerender(<QueryClientProvider client={client}><Harness id="task-1" /></QueryClientProvider>)
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('keeps a feed notification unread until its own card becomes visible', async () => {
    view({ id: 'post-1', observe: true })
    expect(api).not.toHaveBeenCalled()
    await act(async () => { visibilityCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('does not mark notifications while the browser tab is hidden', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    view({ id: 'task-1' })
    expect(api).not.toHaveBeenCalled()
    hidden.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(api).toHaveBeenCalledTimes(1)
  })
})
