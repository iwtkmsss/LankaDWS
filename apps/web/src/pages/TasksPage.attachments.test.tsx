import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import { TopbarContentProvider } from '../layout/TopbarContent'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user', accountType: 'USER' } }) }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))
vi.mock('../features/drive/DrivePicker', () => ({
  DrivePicker: ({ onPick, onClose }: { onPick: (file: { id: string }) => void; onClose: () => void }) => (
    <button onClick={() => { onPick({ id: 'file_1' }); onClose() }}>Вибрати файл із Диска</button>
  ),
}))

const attachment = { id: 'file_1', fileName: 'Фото.jpg', mimeType: 'image/jpeg', bytes: 1024, scanStatus: 'CLEAN' }
const user = { id: 'user', displayName: 'Анна' }
const task = {
  id: 'task_1', number: '123', title: 'Перевірка', description: '', version: 1,
  status: 'NEW', priority: 'MEDIUM', reporter: user, assignee: user,
  availableStatusActions: [], attachments: [], sourceLinks: [], comments: [], checklist: [],
  subtasks: [], coExecutors: [], observers: [], subtaskProgress: { done: 0, total: 0 },
  personalState: { reminders: [] }, canAttachFiles: true,
  createdAt: '2026-10-15T08:00:00Z', updatedAt: '2026-10-15T08:00:00Z',
}

function renderTask() {
  const router = createMemoryRouter([{ path: '/tasks/:taskId', element: <TasksPage /> }], {
    initialEntries: ['/tasks/task_1'],
  })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TopbarContentProvider><RouterProvider router={router} /></TopbarContentProvider>
  </QueryClientProvider>)
}

describe('task attachment-only comments', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    request.mockReset()
    request.mockImplementation((url: string) => Promise.resolve(
      url === '/tasks/task_1' ? task
        : ['/tasks/task_1/attachments?draft=true', '/tasks/task_1/attachments/from-drive?draft=true'].includes(url)
          ? attachment : { items: [] },
    ))
  })

  it('shows avatar, author and heading timestamp for every comment including consecutive messages', async () => {
    const initialRequest = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/tasks/task_1') return Promise.resolve({ ...task, comments: [0, 1, 3].map((minute) => ({
        id: `comment_${minute}`, author: user, body: `Повідомлення ${minute}`,
        createdAt: `2026-10-15T08:0${minute}:00Z`, attachments: [], mentions: [],
        replyToCommentId: null, replyPreview: null, reactions: { likeCount: 0, likedByMe: false },
      })) })
      if (url === '/tasks/task_1/activity') return Promise.resolve({ items: [{
        id: 'event', action: 'task.updated', label: 'Завдання оновлено',
        createdAt: '2026-10-15T08:02:00Z', actor: user,
      }], nextCursor: null })
      return initialRequest(url, init)
    })
    renderTask()
    await screen.findByText('Повідомлення 3')
    await screen.findByText(/Завдання оновлено/)
    const comments = document.querySelectorAll('.task-comment')
    expect(comments).toHaveLength(3)
    comments.forEach((comment) => {
      expect(comment.querySelector('.task-comment__heading .task-comment__author')).not.toBeNull()
      expect(comment.querySelector('a.task-comment__author-avatar')).not.toBeNull()
      expect(comment.querySelector('.task-comment__heading time')).not.toBeNull()
      expect(comment.querySelector('.task-comment__meta time')).toBeNull()
    })
  })

  it.each([
    ['application/msword', 'Word'], ['application/vnd.ms-excel', 'Excel'], ['application/vnd.ms-powerpoint', 'PowerPoint'],
  ])('uses the shared %s icon in task materials and comments', async (mimeType, name) => {
    const original = request.getMockImplementation()!
    const office = { ...attachment, fileName: name, mimeType }
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, attachments: [office], comments: [{
        id: 'office-comment', author: user, body: '', createdAt: task.createdAt, attachments: [office],
        mentions: [], replyToCommentId: null, replyPreview: null, reactions: { likeCount: 0, likedByMe: false },
      }] }) : original(url, init))
    renderTask()
    expect(await screen.findByRole('img', { name: `Формат ${name}` })).toHaveClass('file-format-icon--office')
    fireEvent.click(await screen.findByText('Матеріали'))
    expect(await screen.findAllByRole('img', { name: `Формат ${name}` })).toHaveLength(2)
  })

  it('offers download and icon-only Drive saving before removal in task materials', async () => {
    const initialRequest = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, attachments: [{ ...attachment, canRemove: true }] })
      : initialRequest(url, init))
    renderTask()
    fireEvent.click(await screen.findByText('Матеріали'))
    const download = await screen.findByRole('link', { name: 'Завантажити Фото.jpg' })
    expect(download).toHaveAttribute('href', '/api/v1/files/file_1/download')
    const save = screen.getByRole('button', { name: 'Зберегти на Диск' })
    expect(download.nextElementSibling).toBe(save)
    expect(save.nextElementSibling).toBe(screen.getByRole('button', { name: 'Вилучити Фото.jpg' }))
    fireEvent.click(save)
    await screen.findByRole('button', { name: 'Збережено на Диск' })
    expect(request).toHaveBeenCalledWith('/drive/import-file', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ fileId: 'file_1', name: 'Фото' }),
    }))
  })

  it('offers the shared PDF preview in task discussion', async () => {
    const initialRequest = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, comments: [{
        id: 'comment_pdf', author: user, body: '', createdAt: task.createdAt,
        attachments: [{ ...attachment, fileName: 'Звіт.pdf', mimeType: 'application/pdf' }],
        mentions: [], replyToCommentId: null, replyPreview: null,
        reactions: { likeCount: 0, likedByMe: false },
      }] }) : initialRequest(url, init))
    renderTask()
    const open = await screen.findByRole('button', { name: 'Переглянути Звіт.pdf' })
    expect(open).toHaveClass('task-attachment', 'is-compact')
    expect(open).toHaveTextContent('Звіт.pdf')
    expect(open.closest('.task-comment-attachments')).not.toBeNull()
  })

  it('sends files without text and clears the selected files after success', async () => {
    const { container } = renderTask()
    const input = await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    const send = screen.getByRole('button', { name: 'Надіслати' })
    expect(send).toBeDisabled()
    fireEvent.change(input, { target: { value: '   ' } })
    expect(send).toBeDisabled()
    fireEvent.change(container.querySelector('.task-comment-form input[type="file"]')!, {
      target: { files: [new File(['image'], 'Фото.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(send).toBeEnabled())
    expect(request).toHaveBeenCalledWith('/tasks/task_1/attachments?draft=true', expect.objectContaining({ method: 'POST' }))
    expect(request.mock.calls.filter(([url]) => url === '/tasks/task_1')).toHaveLength(1)
    expect(screen.queryByLabelText('Файли завдання')).not.toBeInTheDocument()
    expect(screen.queryByText('Файл додано. Він відкриється після безпечної перевірки.')).not.toBeInTheDocument()
    fireEvent.click(send)
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ body: '', mentions: [], replyToCommentId: null, attachmentIds: ['file_1'] }),
    })))
    await waitFor(() => expect(screen.queryByLabelText('Файли коментаря')).not.toBeInTheDocument())
    expect(send).toBeDisabled()
    expect(input).toHaveValue('')
  })

  it('discards an unsent file on the server without updating materials or posting a comment', async () => {
    const { container } = renderTask()
    await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    fireEvent.change(container.querySelector('.task-comment-form input[type="file"]')!, {
      target: { files: [new File(['image'], 'Фото.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Прибрати Фото.jpg з коментаря' }))
    await waitFor(() => expect(screen.queryByLabelText('Файли коментаря')).not.toBeInTheDocument())
    expect(request).toHaveBeenCalledWith('/files/file_1/draft', { method: 'DELETE' })
    expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled()
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/comments' || url === '/tasks/task_1/attachments/file_1')).toBe(false)
    expect(request.mock.calls.filter(([url]) => url === '/tasks/task_1')).toHaveLength(1)
  })

  it('stages a Drive selection without refreshing materials or publishing a comment', async () => {
    renderTask()
    fireEvent.click(await screen.findByRole('button', { name: 'Прикріпити з Диска' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вибрати файл із Диска' }))
    expect(await screen.findByLabelText('Файли коментаря')).toHaveTextContent('Фото.jpg')
    expect(request).toHaveBeenCalledWith('/tasks/task_1/attachments/from-drive?draft=true', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ fileId: 'file_1' }),
    }))
    expect(request.mock.calls.filter(([url]) => url === '/tasks/task_1')).toHaveLength(1)
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/comments')).toBe(false)
  })

  it('preserves files and the idempotency key when retrying a failed send', async () => {
    const initialRequest = request.getMockImplementation()!
    let attempts = 0
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/tasks/task_1/comments') {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('Network unavailable')) : Promise.resolve({ id: 'comment_1' })
      }
      return initialRequest(url, init)
    })
    const { container } = renderTask()
    await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    fireEvent.change(container.querySelector('.task-comment-form input[type="file"]')!, {
      target: { files: [new File(['image'], 'Фото.jpg', { type: 'image/jpeg' })] },
    })
    const send = screen.getByRole('button', { name: 'Надіслати' })
    await waitFor(() => expect(send).toBeEnabled())
    fireEvent.click(send)
    await screen.findByText('Не вдалося надіслати коментар. Перевірте текст і вкладення.')
    expect(screen.getByLabelText('Файли коментаря')).toBeVisible()
    fireEvent.click(send)
    await waitFor(() => expect(screen.queryByLabelText('Файли коментаря')).not.toBeInTheDocument())
    const sends = request.mock.calls.filter(([url]) => url === '/tasks/task_1/comments')
    expect(sends).toHaveLength(2)
    expect(sends[1][1]).toEqual(sends[0][1])
  })
})
