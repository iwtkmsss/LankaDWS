import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'
import { OverlayProvider } from '../shared/ui'

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
    <OverlayProvider><TopbarContentProvider><RouterProvider router={router} /></TopbarContentProvider></OverlayProvider>
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

  it('shows placed photos in the description and keeps their layout through editing', async () => {
    const photo = { id: 'photo_1', fileName: 'plan.png', bytes: 5, mimeType: 'image/png', scanStatus: 'CLEAN', createdAt: '2026-10-15T08:00:00Z', canRemove: true }
    const layout = [{ fileId: 'photo_1', x: 0.1, y: 0.2, width: 0.5, height: 0.25 }]
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, canAttachFiles: true, attachments: [photo], photoLayout: layout }) : original(url))
    const { container } = renderTask()
    expect(await screen.findByRole('button', { name: 'Переглянути plan.png' })).toBeInTheDocument()
    expect(container.querySelector('.inline-photos-canvas__photo')).toBeInTheDocument()
    expect(screen.queryByText('Опис не додано.')).not.toBeInTheDocument()
    await editTask()
    expect(screen.getByRole('button', { name: 'Вставити фото' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Перемістити plan.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining(JSON.stringify(layout)),
    })))
  })

  it('pastes a photo into the description and attaches it only on save', async () => {
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:photo'); static revokeObjectURL = vi.fn() })
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/tasks/task_1/attachments?draft=true') return Promise.resolve({ id: 'staged_1', fileName: 'image.png', mimeType: 'image/png', scanStatus: 'QUARANTINED' })
      if (url === '/tasks/task_1' && !init?.method) return Promise.resolve({ ...task, canAttachFiles: true })
      return original(url)
    })
    renderTask()
    await editTask()
    fireEvent.paste(await screen.findByRole('textbox', { name: 'Опис' }), { clipboardData: { files: [new File(['x'], 'image.png', { type: 'image/png' })] } })
    await screen.findByRole('button', { name: 'Перемістити image.png' })
    expect(request).toHaveBeenCalledWith('/tasks/task_1/attachments?draft=true', expect.objectContaining({ method: 'POST' }))
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/attachments')).toBe(false)
    expect(request.mock.calls.some(([url, init]) => url === '/tasks/task_1' && init?.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('"fileId":"staged_1"'),
    })))
    vi.unstubAllGlobals()
  })

  it('saves the title edited in place of the heading and keeps it on one line', async () => {
    renderTask()
    await editTask()
    const title = await screen.findByRole('textbox', { name: 'Назва' })
    expect(title).not.toHaveFocus()
    fireEvent.change(title, { target: { value: 'Нова\nназва' } })
    expect(title).toHaveValue('Нова назва')
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('"title":"Нова назва"'),
    })))
  })

  it.each([
    ['Додати співвиконавця', 'COLLABORATOR'],
    ['Додати спостерігача', 'WATCHER'],
  ])('adds a person through %s only after confirmation and clears the search', async (label, role) => {
    renderTask()
    await editTask()
    const input = await selectPerson(label)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Богдан')
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/participants/candidate')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Додати' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/participants/candidate', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ role, expectedVersion: 1 }),
    })))
    expect(input).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Додати учасника/ })).not.toBeInTheDocument()
  })

  it('never shows delegation and editing together', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, canReassign: true }) : original(url))
    renderTask()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Делегувати', hidden: true }))
    expect(screen.getByRole('combobox', { name: 'Новий відповідальний' })).toBeInTheDocument()
    await editTask()
    expect(screen.queryByRole('combobox', { name: 'Новий відповідальний' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Делегувати', hidden: true })).not.toBeInTheDocument()
  })

  it('changes the responsible only after confirmation and not when cancelled', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: { method?: string }) => url === '/tasks/task_1' && !init?.method
      ? Promise.resolve({ ...task, canReassign: true }) : original(url))
    renderTask()
    await editTask()
    const patches = () => request.mock.calls.filter(([url, init]) => url === '/tasks/task_1' && init?.method === 'PATCH')
    await selectPerson('Змінити відповідального')
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(patches()).toHaveLength(0)
    await selectPerson('Змінити відповідального')
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Змінити' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]?.[1]?.body).toContain('"assigneeId":"candidate"')
  })

  it('removes a participant only after confirmation', async () => {
    const original = request.getMockImplementation()!
    const observer = { id: 'participant', user: candidate }
    request.mockImplementation((url: string) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, observers: [observer] }) : original(url))
    renderTask()
    await editTask()
    fireEvent.click(await screen.findByRole('button', { name: 'Вилучити Богдан з ролі «Спостерігачі»' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вилучити' }))
    await waitFor(() => expect(request.mock.calls.some(([url, init]) => url.includes('/participants/candidate') && init?.method === 'DELETE')).toBe(true))
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
