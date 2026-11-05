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
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.mockReset().mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST') return { id: 'created' }
    if (path.includes('/audiences')) return { items: [{ companyId: 'mine', label: 'Company' }], ownerCompanyId: 'mine' }
    if (path.includes('/calendar/events?')) return { items: [
      { ...base, id: 'private', title: 'Personal', visibility: 'PRIVATE', kind: 'EVENT' },
      { ...base, id: 'work', title: 'Work', visibility: 'INTERNAL', kind: 'EVENT' },
      { ...base, id: 'task', taskId: 'task', title: 'Deadline', visibility: 'PRIVATE', kind: 'TASK', endAt: base.startAt },
    ], counts: { ALL: 3, MINE: 1, TEAM: 1, TASKS: 1 } }
    if (path === '/tasks/task') return {
      id: 'task', number: '42', title: 'Deadline', status: 'IN_PROGRESS', priority: 'HIGH',
      createdAt: '2026-10-01T08:00:00Z',
      deadline: base.startAt, assignee: { id: 'responsible', displayName: 'Responsible person' },
      reporter: { id: 'me', displayName: 'Me' },
    }
    return null
  })
})

function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const element = <TopbarContentProvider><OverlayProvider><CalendarPage /></OverlayProvider></TopbarContentProvider>
  const router = createMemoryRouter([
    { path: '/calendar', element }, { path: '/calendar/events/:eventId', element },
  ], { initialEntries: [url] })
  render(<QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>)
  return client
}

it.each(['month', 'day', 'week', 'schedule'])('opens a task preview before navigation in %s view', async (view) => {
  open(`/calendar?date=2026-10-05&view=${view}`)
  expect(await screen.findByRole('link', { name: /Deadline/ })).toHaveAttribute('href', `/calendar?date=2026-10-05&view=${view}&task=task`)
  expect(screen.getByRole('link', { name: /Deadline/ })).toHaveClass('calendar-item-task')
  expect(screen.getByRole('link', { name: /Personal/ })).toHaveClass('calendar-item-private')
  expect(screen.getByRole('link', { name: /Work/ })).toHaveClass('calendar-item-work')
  expect(api).not.toHaveBeenCalledWith('/tasks/task')
  fireEvent.click(screen.getByRole('link', { name: /Deadline/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Deadline' })
  expect(dialog).toHaveClass('calendar-event-popover', 'calendar-item-task')
  expect(await within(dialog).findByText('У роботі')).toBeInTheDocument()
  expect(within(dialog).getByText('Responsible person')).toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: 'Перейти до завдання' })).toHaveAttribute('href', '/tasks/task')
  expect(document.body.style.position).not.toBe('fixed')
  expect(dialog).not.toHaveAttribute('aria-modal', 'true')
  expect(document.querySelector('.overlay-layer')).not.toBeInTheDocument()
  expect(document.querySelector('.overlay-app-root')).not.toHaveAttribute('inert')
})

it('switches directly from a loading task preview to an event without a backdrop or close delay', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => args[0] === '/tasks/task' ? new Promise(() => {}) : original(...args))
  open('/calendar?date=2026-10-05')
  fireEvent.click(await screen.findByRole('link', { name: 'Deadline' }))
  const task = await screen.findByRole('dialog', { name: 'Deadline' })
  expect(within(task).getByRole('status')).toHaveTextContent('Завантаження завдання')
  expect(task.querySelector('.page-data-loader')).not.toBeInTheDocument()
  const work = screen.getByRole('link', { name: 'Work' })
  fireEvent.pointerDown(work)
  fireEvent.click(work)
  const event = await screen.findByRole('dialog', { name: 'Work' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(document.querySelector('.overlay-layer')).not.toBeInTheDocument()
  fireEvent.click(within(event).getByRole('button', { name: 'Закрити' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('link', { name: 'Personal' }))
  expect(await screen.findByRole('dialog', { name: 'Personal' })).toBeInTheDocument()
})

it('keeps task filter in the URL and API request', async () => {
  open('/calendar?date=2026-10-05')
  fireEvent.click(await screen.findByRole('tab', { name: /Завдання/ }))
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('scope=TASKS'))).toBe(true))
  expect(await screen.findByRole('tab', { name: /Компанія/ })).toBeInTheDocument()
})

it('shows Personal with its own count and preserves the existing deep link value', async () => {
  open('/calendar?date=2026-10-05')
  fireEvent.click(await screen.findByRole('tab', { name: /Особисті\s*1/ }))
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('scope=MINE'))).toBe(true))
  expect(screen.queryByRole('tab', { name: /Мої/ })).not.toBeInTheDocument()
  expect(await screen.findByRole('tab', { name: /Особисті\s*1/ })).toHaveAttribute('aria-selected', 'true')
})

it('opens a task deep link and preserves calendar filters when closing the preview', async () => {
  open('/calendar?date=2026-10-05&view=week&scope=TASKS&task=task')
  await screen.findByRole('dialog', { name: 'Deadline' })
  expect(api.mock.calls.some(([path]) => path.includes('/calendar/events/task'))).toBe(false)
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: /Deadline/ })).toHaveAttribute('href', '/calendar?date=2026-10-05&view=week&scope=TASKS&task=task')
})

it('does not expose a task link or details when the task is inaccessible', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => {
    if (args[0] === '/tasks/task') throw new Error('Not found')
    return original(...args)
  })
  open('/calendar?date=2026-10-05&task=task')
  const dialog = await screen.findByRole('dialog', { name: 'Завдання недоступне' })
  expect(within(dialog).queryByRole('link', { name: 'Перейти до завдання' })).not.toBeInTheDocument()
  expect(within(dialog).queryByText('Responsible person')).not.toBeInTheDocument()
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
  expect(within(dialog).getByRole('link', { name: /Deadline/ })).toHaveAttribute('href', '/calendar?date=2026-10-05&task=task')
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
  expect(document.body.style.position).toBe('fixed')
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

it('sends acknowledgement only for a shared event and groups the timing controls', async () => {
  open('/calendar?date=2026-10-05&new=1')
  fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Shared meeting' } })
  const acknowledgement = screen.getByRole('checkbox', { name: /Пункт «Ознайомився»/ })
  expect(acknowledgement).toBeDisabled()
  const timing = screen.getByLabelText('Початок').closest('.calendar-event-timing')!
  expect(timing).toContainElement(screen.getByLabelText('Завершення'))
  expect(timing).toContainElement(screen.getByLabelText('Повторення'))
  expect(timing).toContainElement(screen.getByLabelText('Нагадування для себе'))
  fireEvent.click(screen.getByRole('button', { name: /Бачать:/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Company' }))
  expect(acknowledgement).toBeEnabled()
  fireEvent.click(acknowledgement)
  fireEvent.click(screen.getByRole('button', { name: 'Створити подію' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events', expect.objectContaining({ method: 'POST' })))
  const submitted = api.mock.calls.find(([path, options]) => path === '/calendar/events' && options?.method === 'POST')
  expect(JSON.parse(submitted![1].body)).toMatchObject({ requiresAcknowledgement: true, audience: { type: 'COMPANIES', companyIds: ['mine'] } })
})

it('records acknowledgement only after the recipient presses the button', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => args[0] === '/calendar/events/work?company=all' ? {
    ...base, id: 'work', title: 'Shared meeting', visibility: 'INTERNAL', requiresAcknowledgement: true,
    acknowledgement: { requiredForMe: true, acknowledgedAt: null, recipientCount: 2, acknowledgedCount: 0 },
  } : original(...args))
  const client = open('/calendar/events/work')
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const button = await screen.findByRole('button', { name: 'Ознайомився' })
  expect(api.mock.calls.some(([path]) => path.endsWith('/acknowledge'))).toBe(false)
  fireEvent.click(button)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events/work/acknowledge', {
    method: 'POST', body: JSON.stringify({ expectedVersion: 1 }),
  }))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['feed'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendar-event'] })
})

it('opens an anchored event dialog and deletes the whole recurring event only after confirmation', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => {
    if (args[1]?.method === 'DELETE') return { id: 'private' }
    return args[0] === '/calendar/events/private?company=all' ? {
      ...base, id: 'private', title: 'Personal', visibility: 'PRIVATE',
      recurrence: { frequency: 'WEEKLY', interval: 1, until: null },
    } : original(...args)
  })
  const client = open('/calendar?date=2026-10-05')
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(await screen.findByRole('link', { name: 'Personal' }))
  const dialog = await screen.findByRole('dialog', { name: 'Personal' })
  expect(dialog).toHaveClass('calendar-event-popover', 'is-anchored')
  expect(document.body.style.position).not.toBe('fixed')
  const button = within(dialog).getByRole('button', { name: 'Видалити' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const confirmation = await screen.findByRole('alertdialog', { name: 'Видалити всю серію подій?' })
  expect(document.body.style.position).toBe('fixed')
  expect(api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Видалити' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/events/private', {
    method: 'DELETE', body: JSON.stringify({ expectedVersion: 1 }),
  }))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['feed'] })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('does not offer event changes to another organizer’s event', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => args[0] === '/calendar/events/work?company=all' ? {
    ...base, id: 'work', title: 'Shared meeting', ownerId: 'other', visibility: 'INTERNAL',
  } : original(...args))
  open('/calendar/events/work')
  const dialog = await screen.findByRole('dialog', { name: 'Shared meeting' })
  expect(within(dialog).queryByRole('button', { name: 'Видалити' })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument()
})

it('keeps the event open when deletion fails and allows cancelling confirmation', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => {
    if (args[1]?.method === 'DELETE') throw new Error('Conflict')
    return args[0] === '/calendar/events/private?company=all' ? {
      ...base, id: 'private', title: 'Personal', visibility: 'PRIVATE',
    } : original(...args)
  })
  open('/calendar/events/private')
  fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }))
  const confirmation = await screen.findByRole('alertdialog', { name: 'Видалити подію?' })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Видалити' }))
  expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Не вдалося видалити подію')
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Скасувати' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Personal' })).toBeInTheDocument()
  expect(document.body.style.position).not.toBe('fixed')
})

it('keeps the canonical edit form in a popup and restores page scrolling after cancelling', async () => {
  const original = api.getMockImplementation()!
  api.mockImplementation(async (...args) => args[0] === '/calendar/events/private?company=all' ? {
    ...base, id: 'private', title: 'Personal', visibility: 'PRIVATE',
  } : original(...args))
  open('/calendar/events/private')
  const edit = await screen.findByRole('button', { name: 'Редагувати' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  const editor = await screen.findByRole('dialog', { name: 'Редагувати подію' })
  expect(editor).toHaveClass('calendar-event-editor', 'overlay-surface--modal')
  expect(editor).not.toHaveClass('drawer')
  expect(within(editor).getByLabelText('Назва')).toHaveValue('Personal')
  expect(document.body.style.position).toBe('fixed')
  fireEvent.click(within(editor).getByRole('button', { name: 'Скасувати' }))
  await screen.findByRole('dialog', { name: 'Personal' })
  expect(document.body.style.position).not.toBe('fixed')
})
