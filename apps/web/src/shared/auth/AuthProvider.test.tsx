import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

const mocks = vi.hoisted(() => ({ api: vi.fn(), setCsrfToken: vi.fn() }))
vi.mock('../api/client', () => ({ ...mocks, jsonBody: JSON.stringify }))
function State() { return <span>{useAuth().state}</span> }
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe('session revocation', () => {
  it('clears the user and cached private data when the server rejects a session', async () => {
    mocks.api.mockResolvedValue({ csrfToken: 'token', mustEnroll2FA: false })
    const client = new QueryClient()
    client.setQueryData(['private'], 'secret')
    render(<QueryClientProvider client={client}><AuthProvider><State /></AuthProvider></QueryClientProvider>)
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())
    act(() => { window.dispatchEvent(new Event('bert:session-ended')) })
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(client.getQueryData(['private'])).toBeUndefined()
    expect(mocks.setCsrfToken).toHaveBeenLastCalledWith('')
  })
  it('checks an idle session every 15 seconds without refreshing its activity', async () => {
    mocks.api.mockResolvedValue({ csrfToken: 'token', mustEnroll2FA: false })
    vi.useFakeTimers()
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><State /></AuthProvider></QueryClientProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    mocks.api.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(mocks.api).toHaveBeenCalledWith('/me', { headers: { 'x-session-check': '1' } })
  })
})
