import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'
import { NotificationsPage } from './NotificationsPage'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user' } }) }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Drive access notifications', () => {
  it.each([
    ['DOCUMENT', '/drive/doc%2Fone'],
    ['DRIVE_FOLDER', '/drive?folder=doc%2Fone'],
    ['EVENT', '/calendar/events/doc%2Fone'],
  ])('links %s notifications to the shared target', async (entityType, href) => {
    request.mockResolvedValue({ items: [{ id: 'access', category: 'DRIVE',
      safeTitle: 'Вам відкрито доступ до файлу «Договори»', safeSnippet: 'Колега надав доступ для перегляду.',
      entityType, entityId: 'doc/one', requiresAction: false, readAt: null, createdAt: '2026-10-14T10:00:00Z',
    }], counts: { action: 0, unread: 1 } })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/notifications?tab=unread']}>
        <TopbarContentProvider><NotificationsPage /></TopbarContentProvider>
      </MemoryRouter>
    </QueryClientProvider>)
    expect(await screen.findByText('Вам відкрито доступ до файлу «Договори»')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Відкрити' })).toHaveAttribute('href', href)
    expect(screen.getByRole('tab', { name: /Непрочитані\s*1/ })).toBeVisible()
  })
})

describe('notification filter transitions', () => {
  it('keeps the list and counts while loading another tab and disables stale actions', async () => {
    const initial = { items: [{ id: 'notification', safeTitle: 'Оновлено завдання', safeSnippet: 'Змінено строк',
      category: 'TASKS', readAt: null, requiresAction: true, createdAt: '2026-10-13T10:00:00Z' }],
      counts: { action: 1, unread: 12 } }
    let resolveNext!: (value: typeof initial) => void
    const next = new Promise<typeof initial>((resolve) => { resolveNext = resolve })
    request.mockImplementation((url: string) => url === '/notifications?tab=action' ? Promise.resolve(initial) : next)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/notifications']}>
        <TopbarContentProvider><TopbarContent /><NotificationsPage /></TopbarContentProvider>
      </MemoryRouter>
    </QueryClientProvider>)
    expect(await screen.findByText('Оновлено завдання')).toBeVisible()
    const bulk = screen.getByRole('button', { name: 'Позначити все прочитаним' })
    await waitFor(() => expect(bulk).toBeEnabled())
    fireEvent.click(screen.getByRole('tab', { name: 'Усі' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/notifications?tab=all'))
    expect(screen.getByText('Оновлено завдання')).toBeVisible()
    expect(screen.getByRole('tab', { name: /Непрочитані\s*12/ })).toBeVisible()
    expect(bulk).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Прочитано' })).toBeDisabled()
    await act(async () => resolveNext({ items: [], counts: { action: 0, unread: 0 } }))
    expect(await screen.findByText('Черга порожня')).toBeVisible()
    expect(bulk).toBeVisible()
    expect(bulk).toBeDisabled()
    expect(screen.getByRole('tab', { name: /Непрочитані\s*0/ })).toBeVisible()
  })
})
