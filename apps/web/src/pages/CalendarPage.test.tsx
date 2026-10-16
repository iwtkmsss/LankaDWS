import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import CalendarPage from './CalendarPage'
import { TopbarContentProvider } from '../layout/TopbarContent'
import { OverlayProvider } from '../shared/ui/Overlay'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../shared/api/client', () => ({ api, jsonBody: JSON.stringify, idempotencyKey: () => 'key' }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me' }, canUseCapability: () => true }) }))
const base = { companyId: 'mine', ownerId: 'me', ownerName: 'Me', description: null, allDay: false,
  startAt: '2026-10-05T09:00:00Z', endAt: '2026-10-05T10:00:00Z', sourceTimezone: 'Europe/Kyiv', version: 1,
  audienceCompanyIds: ['mine'], audienceLabel: 'Company' }

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.mockReset().mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST') return { id: 'created' }
    if (path.includes('/audiences')) return { items: [{ companyId: 'mine', label: 'Company' }], ownerCompanyId: 'mine' }
    if (path.includes('/calendar/events?')) return { items: [
      { ...base, id: 'private', title: 'Personal', visibility: 'PRIVATE', kind: 'EVENT' },
      { ...base, id: 'work', title: 'Work', visibility: 'INTERNAL', kind: 'EVENT' },
      { ...base, id: 'task', taskId: 'task', title: 'Deadline', visibility: 'PRIVATE', kind: 'TASK', endAt: base.startAt },
    ], counts: { ALL: 3, MINE: 3, TEAM: 2, TASKS: 1 } }
    return null
  })
})

function open(url: string) {
  const element = <TopbarContentProvider><OverlayProvider><CalendarPage /></OverlayProvider></TopbarContentProvider>
  const router = createMemoryRouter([
    { path: '/calendar', element }, { path: '/calendar/events/:eventId', element },
  ], { initialEntries: [url] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
  </QueryClientProvider>)
}

it.each(['month', 'day', 'week', 'schedule'])('colors all categories and links deadlines to tasks in %s view', async (view) => {
  open(`/calendar?date=2026-10-05&view=${view}`)
  expect(await screen.findByRole('link', { name: /Deadline/ })).toHaveAttribute('href', '/tasks/task')
  expect(screen.getByRole('link', { name: /Deadline/ })).toHaveClass('calendar-item-task')
  expect(screen.getByRole('link', { name: /Personal/ })).toHaveClass('calendar-item-private')
  expect(screen.getByRole('link', { name: /Work/ })).toHaveClass('calendar-item-work')
})

it('keeps task filter in the URL and API request', async () => {
  open('/calendar?date=2026-10-05')
  fireEvent.click(await screen.findByRole('tab', { name: /Завдання/ }))
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('scope=TASKS'))).toBe(true))
  expect(await screen.findByRole('tab', { name: /Моя компанія/ })).toBeInTheDocument()
})

it('opens every event from the overflow button and closes the day list', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => {
    const result = await original(...args)
    if (args[0].includes('/calendar/events?')) result.items.push({
      ...base, id: 'hidden', title: 'Hidden meeting with a full title', description: 'Discuss the next steps.',
      visibility: 'INTERNAL', kind: 'EVENT',
    })
    return result
  })
  open('/calendar?date=2026-10-05')
  fireEvent.click(await screen.findByRole('button', { name: 'Переглянути всі події на 5 жовтня' }))
  const dialog = await screen.findByRole('dialog', { name: '5 жовтня 2026 р.' })
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
  expect(within(dialog).getByText('Discuss the next steps.')).toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: /Hidden meeting/ })).toHaveAttribute('href', '/calendar/events/hidden?date=2026-10-05')
  expect(within(dialog).getByRole('link', { name: /Deadline/ })).toHaveAttribute('href', '/tasks/task')
  fireEvent.click(within(dialog).getByRole('button', { name: /Закрити/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('opens the day list from the date and creates an event for that day', async () => {
  open('/calendar?date=2026-10-05')
  await screen.findByRole('link', { name: /Personal/ })
  fireEvent.click(screen.getByRole('button', { name: 'Переглянути події на 6 жовтня' }))
  const dialog = await screen.findByRole('dialog', { name: '6 жовтня 2026 р.' })
  expect(within(dialog).getByText('На цей день подій немає')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Створити подію' }))
  const createDialog = await screen.findByRole('dialog', { name: 'Нова подія' })
  expect(within(createDialog).getByLabelText('Початок')).toHaveValue('2026-10-06T09:00')
})

it('submits a recurring private event using the canonical create form', async () => {
  open('/calendar?date=2026-10-05&new=1')
  fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Recurring meeting' } })
  fireEvent.change(screen.getByLabelText('Повторення'), { target: { value: 'WEEKLY' } })
  fireEvent.change(screen.getByLabelText('Кожні (днів / тижнів / місяців)'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Створити подію' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events', expect.objectContaining({ method: 'POST' })))
  const submitted = api.mock.calls.find(([path, options]) => path === '/calendar/events' && options?.method === 'POST')
  expect(JSON.parse(submitted![1].body)).toMatchObject({ audience: { type: 'PRIVATE' }, recurrence: { frequency: 'WEEKLY', interval: 2, until: null } })
})

it('submits a personal reminder and disables and clears it for a company audience', async () => {
  open('/calendar?date=2026-10-05&new=1')
  fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'My reminder' } })
  const reminder = screen.getByLabelText('Нагадування для себе')
  expect(reminder).toBeEnabled()
  fireEvent.change(reminder, { target: { value: '15' } })
  fireEvent.click(screen.getByRole('button', { name: /Бачать:/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Company' }))
  expect(reminder).toBeDisabled()
  expect(reminder).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Створити подію' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events', expect.objectContaining({ method: 'POST' })))
  const submitted = api.mock.calls.find(([path, options]) => path === '/calendar/events' && options?.method === 'POST')
  expect(JSON.parse(submitted![1].body)).toMatchObject({ audience: { type: 'COMPANIES', companyIds: ['mine'] }, reminderMinutes: null })
})

it('sends the selected reminder time with a private event', async () => {
  open('/calendar?date=2026-10-05&new=1')
  fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Personal appointment' } })
  fireEvent.change(screen.getByLabelText('Нагадування для себе'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Створити подію' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events', expect.objectContaining({ method: 'POST' })))
  const submitted = api.mock.calls.find(([path, options]) => path === '/calendar/events' && options?.method === 'POST')
  expect(JSON.parse(submitted![1].body)).toMatchObject({ audience: { type: 'PRIVATE' }, reminderMinutes: 0 })
})
