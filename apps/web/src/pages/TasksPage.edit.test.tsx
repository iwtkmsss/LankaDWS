import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'admin', accountType: 'ADMIN' } }) }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))

const person = { id: 'reporter', displayName: 'Анна', jobTitle: '' }
const candidate = { id: 'candidate', displayName: 'Богдан', jobTitle: '' }
const task = {
  id: 'task_1', number: '123', title: 'Перевірка', description: '', version: 1,
  status: 'NEW', priority: 'MEDIUM', reporter: person, creator: person, assignee: person,
  availableStatusActions: [], attachments: [], sourceLinks: [], comments: [], checklist: [],
  subtasks: [], coExecutors: [], observers: [], subtaskProgress: { done: 0, total: 0 },
  personalState: { reminders: [] }, canEdit: true, canTransferCreator: true, canManageParticipants: true,
  createdAt: '2026-10-15T08:00:00Z', updatedAt: '2026-10-15T08:00:00Z',
}

function renderTask() {
  const router = createMemoryRouter([{
    element: <><TopbarContent /><Outlet /></>,
    children: [{ path: '/tasks/:taskId', element: <TasksPage /> }],
  }], { initialEntries: ['/tasks/task_1'] })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TopbarContentProvider><RouterProvider router={router} /></TopbarContentProvider>
  </QueryClientProvider>)
}

async function editTask() {
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Редагувати', hidden: true }))
}

async function selectPerson(label: string) {
  const input = screen.getByRole('combobox', { name: label })
  fireEvent.change(input, { target: { value: 'Б' } })
  fireEvent.mouseDown(await screen.findByRole('option', { name: 'Богдан' }))
  return input
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  request.mockReset()
  request.mockImplementation((url: string) => Promise.resolve(
    url === '/tasks/task_1' ? task : url.startsWith('/employees?') ? { items: [candidate] } : { items: [] },
  ))
})

describe('task detail editing', { timeout: 15_000 }, () => {
  it('keeps the create action and saves a reporter selected from the sidebar with the main form', async () => {
    renderTask()
    expect(await screen.findByRole('link', { name: 'Створити завдання' })).toHaveAttribute('href', '/tasks/new')
    await editTask()
    const reporterCard = screen.getByRole('region', { name: 'Постановник' })
    expect(within(reporterCard).getByRole('combobox', { name: 'Змінити постановника' })).toBeInTheDocument()
    await selectPerson('Змінити постановника')
    expect(request.mock.calls.some(([url, init]) => url === '/tasks/task_1' && init?.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('"creatorId":"candidate"'),
    })))
  })

  it.each([
    ['Додати співвиконавця', 'COLLABORATOR'],
    ['Додати спостерігача', 'WATCHER'],
  ])('adds a person immediately through %s and clears the search', async (label, role) => {
    renderTask()
    await editTask()
    const input = await selectPerson(label)
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/participants/candidate', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ role, expectedVersion: 1 }),
    })))
    expect(input).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Додати учасника/ })).not.toBeInTheDocument()
  })

  it('hides the reporter selector when the server denies transfer', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, canTransferCreator: false }) : original(url))
    renderTask()
    await editTask()
    expect(screen.queryByRole('combobox', { name: 'Змінити постановника' })).not.toBeInTheDocument()
  })
})
