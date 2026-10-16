import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { FeedOverview } from './FeedOverview'

const { request, profile } = vi.hoisted(() => ({
  request: vi.fn(),
  profile: { id: 'usr_dmytro', displayName: 'Савчук Дмитро', firstName: 'Дмитро' },
}))
vi.mock('../shared/api/client', () => ({ api: request }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: profile }) }))
afterEach(() => {
  cleanup()
  request.mockReset()
  Object.assign(profile, { id: 'usr_dmytro', displayName: 'Савчук Дмитро', firstName: 'Дмитро' })
})

it('refreshes a recent cached next step and links to the pending mandatory article', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
  const cached = {
    attentionCount: 0,
    meta: { localDate: '2026-10-07' },
    focus: { nextStep: { title: 'Завдання', detail: 'Поточне завдання' }, primaryAction: { href: '/tasks/task', label: 'Відкрити завдання' } },
    kpis: {},
  }
  client.setQueryData(['dashboard'], cached)
  request.mockResolvedValue({
    ...cached,
    attentionCount: 1,
    focus: { nextStep: { title: 'Ознайомтеся з матеріалом «Інструкція»', detail: 'Обов’язкове ознайомлення' }, primaryAction: { href: '/knowledge/guide', label: 'Відкрити базу знань' } },
  })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/feed?filter=ACK_REQUIRED']}><FeedOverview /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByText('Ознайомтеся з матеріалом «Інструкція»')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Відкрити базу знань/ })).toHaveAttribute('href', '/knowledge/guide')
  expect(screen.queryByRole('link', { name: /Відкрити завдання/ })).toBeNull()
  expect(request).toHaveBeenCalledWith('/dashboard')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Дмитро, ось що зараз потребує уваги.')
})

it.each([0, 2])('shows the upcoming event title or today count (%i) and opens the relevant calendar view', async (todayCount) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  request.mockResolvedValue({
    attentionCount: 0,
    meta: { localDate: '2026-10-13' },
    focus: { nextStep: null, primaryAction: { href: '/tasks/new', label: 'Створити завдання' } },
    events: [{ id: 'evt_future', title: 'Планування наступного тижня', startAt: '2026-10-14T09:00:00.000Z' }],
    kpis: { events: { todayCount, nextAt: '2026-10-14T09:00:00.000Z', href: '/calendar' } },
  })
  render(<QueryClientProvider client={client}><MemoryRouter><FeedOverview /></MemoryRouter></QueryClientProvider>)
  const card = await screen.findByRole('link', { name: todayCount ? /Події сьогодні/ : /Найближча подія/ })
  expect(card).toHaveAttribute('href', todayCount ? '/calendar' : '/calendar/events/evt_future')
  expect(card.querySelector('strong')).toHaveTextContent(todayCount ? '2' : 'Планування наступного тижня')
  if (todayCount) expect(card.querySelector('em')).toBeNull()
  else expect(card.querySelector('em')).toHaveTextContent('14 жовт.')
})

it('uses the given name for a surname-first profile', async () => {
  Object.assign(profile, { id: 'usr_regular', displayName: 'Дарієнко Вадим', firstName: 'Вадим' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  request.mockResolvedValue({
    attentionCount: 1,
    meta: { localDate: '2026-10-14' },
    focus: { nextStep: null, primaryAction: { href: '/tasks', label: 'Відкрити завдання' } },
    kpis: {},
  })
  render(<QueryClientProvider client={client}><MemoryRouter><FeedOverview /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Вадим, ось що зараз потребує уваги.')
})
