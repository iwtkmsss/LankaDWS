import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import { TopbarContentProvider } from '../layout/TopbarContent'
import { AppNotice } from '../shared/ui/AppNotice'
import { OverlayProvider } from '../shared/ui/Overlay'

// Hidden content is restorable (decision 2026-11-18): «Скасувати» on success
// notices and an administrator's in-place view of hidden records.

const { request, auth } = vi.hoisted(() => ({
  request: vi.fn(),
  auth: { user: { id: 'user', accountType: 'USER' as 'USER' | 'ADMIN' } },
}))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => auth }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))

const user = { id: 'user', displayName: 'Анна' }
const attachment = { id: 'file_1', fileName: 'Фото.jpg', mimeType: 'image/jpeg', bytes: 1024, scanStatus: 'CLEAN', canRemove: true }
const task = {
  id: 'task_1', number: '123', title: 'Перевірка', description: '', version: 4,
  status: 'NEW', priority: 'MEDIUM', reporter: user, creator: user, assignee: user,
  availableStatusActions: [], attachments: [], sourceLinks: [], comments: [], checklist: [],
  subtasks: [], coExecutors: [], observers: [], subtaskProgress: { done: 0, total: 0 },
  personalState: { reminders: [] }, canAttachFiles: true, canEdit: true,
  createdAt: '2026-10-15T08:00:00Z', updatedAt: '2026-10-15T08:00:00Z',
}
const comment = {
  id: 'comment_1', author: user, body: 'Перший коментар', createdAt: '2026-10-15T08:01:00Z',
  attachments: [], mentions: [], replyToCommentId: null, replyPreview: null,
  reactions: { likeCount: 0, likedByMe: false }, version: 2, canEdit: true, canDelete: true,
}

function respondWith(detail: object) {
  request.mockImplementation((url: string) => Promise.resolve(
    url === '/tasks/task_1' ? detail : url.endsWith('/activity') ? { items: [], nextCursor: null } : {},
  ))
}

function renderTask() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/tasks/:taskId', element: <TasksPage /> }], {
    initialEntries: ['/tasks/task_1'],
  })
  return render(<QueryClientProvider client={client}><OverlayProvider>
    <TopbarContentProvider><RouterProvider router={router} /></TopbarContentProvider>
    <AppNotice />
  </OverlayProvider></QueryClientProvider>)
}

describe('task restore wiring', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    request.mockReset()
    auth.user = { id: 'user', accountType: 'USER' }
  })
  afterEach(() => cleanup())

  it('undoes a removed attachment through its restore endpoint', async () => {
    respondWith({ ...task, attachments: [attachment] })
    renderTask()
    fireEvent.click(await screen.findByText('Матеріали'))
    fireEvent.click(await screen.findByRole('button', { name: 'Вилучити Фото.jpg' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/attachments/file_1', expect.objectContaining({ method: 'DELETE' })))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('Файл видалено')
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Скасувати' })) })
    expect(request).toHaveBeenCalledWith('/tasks/task_1/attachments/file_1/restore', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Дію скасовано')
  })

  it('undoes a deleted comment with the comment version the deletion produced', async () => {
    auth.user = { id: 'user', accountType: 'ADMIN' }
    respondWith({ ...task, comments: [comment] })
    renderTask()
    const text = await screen.findByText('Перший коментар')
    fireEvent.contextMenu(text)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Видалити/ }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Видалити/ }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments/comment_1', expect.objectContaining({ method: 'DELETE' })))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('Коментар видалено')
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Скасувати' })) })
    expect(request).toHaveBeenCalledWith('/tasks/task_1/comments/comment_1/restore', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 3 }),
    }))
  })

  it('shows an administrator the hidden comment in place, muted, with who hid it and a restore action', async () => {
    auth.user = { id: 'user', accountType: 'ADMIN' }
    respondWith({ ...task, comments: [
      { ...comment, canEdit: false, canDelete: false, deletedAt: '2026-10-15T09:00:00Z', deletedBy: { id: 'admin', displayName: 'Олег' } },
    ] })
    renderTask()
    const hidden = (await screen.findByText('Перший коментар')).closest('article')!
    expect(hidden).toHaveClass('is-hidden')
    expect(hidden).toHaveAccessibleName('Видалений коментар: Анна')
    expect(within(hidden).getByText(/^Видалено Олег, /)).toBeInTheDocument()
    fireEvent.click(within(hidden).getByRole('button', { name: 'Відновити коментар' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments/comment_1/restore', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 2 }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Коментар відновлено')
  })

  it('lists hidden checklist items in a collapsed area and offers an archived task back', async () => {
    auth.user = { id: 'user', accountType: 'ADMIN' }
    respondWith({ ...task, status: 'ARCHIVED', canRestore: true, hiddenContent: {
      checklist: [{ id: 'item_1', text: 'Узгодити бюджет', isDone: false, version: 2, deletedAt: '2026-10-15T09:00:00Z', deletedBy: user }],
      attachments: [], relations: [], timeEntries: [],
    } })
    renderTask()
    fireEvent.click(await screen.findByText('Чек-лист'))
    fireEvent.click(await screen.findByText('Видалені (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Відновити «Узгодити бюджет»' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/checklist/item_1/restore', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 4 }),
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Відновити завдання' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/restore', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 4 }),
    })))
  })

  it('gives an ordinary reader no restore affordances', async () => {
    respondWith({ ...task, comments: [{ ...comment, canEdit: false, canDelete: false }] })
    renderTask()
    await screen.findByText('Перший коментар')
    expect(screen.queryByText(/^Видалені \(/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Відновити/ })).not.toBeInTheDocument()
  })
})
