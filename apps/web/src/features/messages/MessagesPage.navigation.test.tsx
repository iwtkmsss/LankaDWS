import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { TopbarContentProvider } from '../../layout/TopbarContent'
import { UserProfileProvider } from '../employees/UserProfileDrawer'
import { MessagesPage } from './MessagesPage'
import { getChatUser, getRecommendedChatUsers } from './api/messageApi'

vi.mock('../../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', accountType: 'USER', company: { id: 'company-1' } } }),
}))
vi.mock('./components/ConversationPane', () => ({ ConversationPane: () => <div>Відкритий діалог</div> }))
vi.mock('./components/DirectDraftPane', () => ({ DirectDraftPane: () => <div>Новий діалог</div> }))
vi.mock('./api/messageApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api/messageApi')>(),
  getThreadPage: vi.fn().mockResolvedValue({ items: [], counts: { all: 0, unread: 0 }, nextCursor: null }),
  getRecommendedChatUsers: vi.fn(),
  getChatUser: vi.fn(),
  getThreadDetail: vi.fn().mockResolvedValue({ id: 'thread-1' }),
  getMessagePage: vi.fn().mockResolvedValue({ items: [], olderCursor: null, newerCursor: null }),
  searchChatUsers: vi.fn().mockResolvedValue({ items: [] }),
}))

const contact = {
  id: 'colleague', displayName: 'Колега', avatarAsset: null, username: 'colleague',
  jobTitle: 'Співробітник',
  directThreadId: null,
}

beforeEach(() => {
  vi.mocked(getRecommendedChatUsers).mockResolvedValue({ items: [{ ...contact, reason: 'TEAM' }] })
  vi.mocked(getChatUser).mockResolvedValue(contact)
})

function openPage(entry = '/messages') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const element = <QueryClientProvider client={client}>
    <TopbarContentProvider><UserProfileProvider><MessagesPage /></UserProfileProvider></TopbarContentProvider>
  </QueryClientProvider>
  const router = createMemoryRouter([
    { path: '/messages', element },
    { path: '/messages/:threadId', element },
  ], { initialEntries: [entry] })
  const navigations: string[] = []
  router.subscribe((state) => navigations.push(state.location.pathname + state.location.search))
  render(<RouterProvider router={router} />)
  return { router, navigations }
}

it('opens a recommended contact without rewriting the destination URL', async () => {
  const { router, navigations } = openPage()
  fireEvent.click(await screen.findByRole('button', { name: /Колега/ }))
  await screen.findByText('Новий діалог')
  expect(router.state.location.search).toBe('?to=colleague')
  expect(navigations).toEqual(['/messages?to=colleague'])
})

it('resolves an existing direct thread once without returning to the draft URL', async () => {
  vi.mocked(getRecommendedChatUsers).mockResolvedValue({
    items: [{ ...contact, directThreadId: undefined, reason: 'RECENT' }],
  })
  vi.mocked(getChatUser).mockResolvedValue({ ...contact, directThreadId: 'thread-1' })
  const { router, navigations } = openPage()
  fireEvent.click(await screen.findByRole('button', { name: /Колега/ }))
  await screen.findByText('Відкритий діалог')
  expect(router.state.location.pathname).toBe('/messages/thread-1')
  expect(navigations).toEqual(['/messages/thread-1'])
})

it('keeps the current screen while resolving a recommendation without a thread ID', async () => {
  vi.mocked(getRecommendedChatUsers).mockResolvedValue({
    items: [{ ...contact, directThreadId: undefined, reason: 'TEAM' }],
  })
  let resolveContact!: (value: typeof contact) => void
  vi.mocked(getChatUser).mockImplementation(() => new Promise((resolve) => { resolveContact = resolve }))
  const { router, navigations } = openPage()
  fireEvent.click(await screen.findByRole('button', { name: /Колега/ }))
  expect(router.state.location.pathname).toBe('/messages')
  expect(router.state.location.search).toBe('')
  expect(navigations).toEqual([])
  await act(async () => { resolveContact(contact) })
  await screen.findByText('Новий діалог')
  expect(navigations).toEqual(['/messages?to=colleague'])
})

it('opens a known recommended thread in a single navigation', async () => {
  vi.mocked(getRecommendedChatUsers).mockResolvedValue({
    items: [{ ...contact, directThreadId: 'thread-1', reason: 'RECENT' }],
  })
  const { navigations } = openPage()
  fireEvent.click(await screen.findByRole('button', { name: /Колега/ }))
  await screen.findByText('Відкритий діалог')
  expect(navigations).toEqual(['/messages/thread-1'])
})

it('restores the URL search after going back without an extra navigation', async () => {
  const { router, navigations } = openPage('/messages?q=Марко&unread=true')
  const input = screen.getByRole('combobox', { name: 'Пошук користувачів' })
  await act(async () => { await router.navigate('/messages?to=colleague') })
  await screen.findByText('Новий діалог')
  expect(input).toHaveValue('')
  await act(async () => { await router.navigate(-1) })
  await waitFor(() => expect(input).toHaveValue('Марко'))
  expect(router.state.location.search).toBe('?q=Марко&unread=true')
  expect(navigations).toEqual(['/messages?to=colleague', '/messages?q=Марко&unread=true'])
})
