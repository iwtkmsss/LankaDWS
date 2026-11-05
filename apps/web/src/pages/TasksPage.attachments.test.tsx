import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function renderTask(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter([{ path: '/tasks/:taskId', element: <TasksPage /> }], {
    initialEntries: ['/tasks/task_1'],
  })
  return render(<QueryClientProvider client={client}>
    <TopbarContentProvider><RouterProvider router={router} /></TopbarContentProvider>
  </QueryClientProvider>)
}

describe('task attachment-only comments', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('task-discussion__body') ? 450 : 0 } })
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
    expect(document.querySelector('.task-system-event')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Розгорнути чат' }))
    expect(document.querySelector('.task-system-event')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Згорнути чат' }))
    expect(document.querySelector('.task-system-event')).toBeVisible()
    const comments = document.querySelectorAll('.task-comment')
    expect(comments).toHaveLength(3)
    comments.forEach((comment) => {
      expect(comment.querySelector('.task-comment__heading .task-comment__author')).not.toBeNull()
      expect(comment.querySelector('a.task-comment__author-avatar')).not.toBeNull()
      expect(comment.querySelector('.task-comment__heading time')).not.toBeNull()
      expect(comment.querySelector('.task-comment__meta time')).toBeNull()
    })
  })

  it('previews the ten latest comments and expands full paginated history with a return-to-top action', async () => {
    const initialRequest = request.getMockImplementation()!
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/tasks/task_1') return Promise.resolve({ ...task, comments: Array.from({ length: 15 }, (_, index) => ({
        id: `comment_${index}`, author: user, body: `Текст ${index}`,
        createdAt: new Date(Date.parse(task.createdAt) + index * 60000).toISOString(), attachments: [], mentions: [],
        replyToCommentId: null, replyPreview: null, reactions: { likeCount: 0, likedByMe: false },
      })) })
      if (url === '/tasks/task_1/activity') return Promise.resolve({ items: [], nextCursor: 'older' })
      if (url === '/tasks/task_1/activity?cursor=older') return Promise.resolve({ items: [{
        id: 'older_event', action: 'task.updated', label: 'Давня подія', createdAt: task.createdAt, actor: user,
      }], nextCursor: null })
      return initialRequest(url, init)
    })
    renderTask()
    await screen.findByText('Текст 14')
    expect(document.querySelectorAll('.task-comment-row:not(.is-history-peek)')).toHaveLength(10)
    expect(document.querySelector('.task-comment-row.is-history-peek')).not.toBeNull()
    expect(screen.getByText('Текст 4').closest<HTMLElement>('.task-comment-row')?.inert).toBe(true)
    const expand = screen.getByRole('button', { name: 'Розгорнути чат' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/activity?cursor=older')).toBe(false)
    fireEvent.click(expand)
    await screen.findByText(/Давня подія/)
    expect(document.querySelectorAll('.task-comment')).toHaveLength(15)
    const section = document.querySelector('.task-discussion')!
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ top: -200 } as DOMRect)
    fireEvent.scroll(window)
    fireEvent.click(await screen.findByRole('button', { name: 'До початку чату' }))
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    fireEvent.click(screen.getByRole('button', { name: 'Згорнути чат' }))
    expect(document.querySelectorAll('.task-comment-row:not(.is-history-peek)')).toHaveLength(10)
    expect(document.querySelector('.task-comment-row.is-history-peek')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'До початку чату' })).not.toBeInTheDocument()
  })

  it('hides whole older messages that do not fit and restores their controls when expanded', async () => {
    const original = request.getMockImplementation()!
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('task-comment-row') ? 100 : 0 } as DOMRect
    })
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, comments: Array.from({ length: 10 }, (_, index) => ({
        id: `fit_${index}`, author: user, body: `Рядок ${index}`, createdAt: task.createdAt,
        attachments: [], mentions: [], replyToCommentId: null, replyPreview: null,
        reactions: { likeCount: 0, likedByMe: false },
      })) }) : original(url, init))
    try {
      renderTask()
      await screen.findByText('Рядок 9')
      const comments = Array.from(document.querySelectorAll<HTMLElement>('.task-comment-row'))
      expect(comments.slice(-4).every((item) => item.style.visibility === '' && !item.inert)).toBe(true)
      expect(comments[5]).toHaveClass('is-history-peek')
      expect(parseFloat(comments[5].style.getPropertyValue('--history-peek-height'))).toBeGreaterThan(22)
      expect(comments[5].inert).toBe(true)
      expect(comments.slice(0, 5).every((item) => item.style.visibility === 'hidden' && item.inert)).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Розгорнути чат' }))
      expect(comments.every((item) => item.style.visibility === '' && !item.inert)).toBe(true)
      expect(document.querySelector('.is-history-peek')).toBeNull()
    } finally {
      geometry.mockRestore()
    }
  })

  it('keeps side actions in the full-width message row and replies to the selected task comment', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, comments: [{
        id: 'nearby', author: user, body: 'Уточнення до завдання', createdAt: task.createdAt,
        attachments: [], mentions: [], replyToCommentId: null, replyPreview: null,
        reactions: { likeCount: 0, likedByMe: false },
      }] }) : original(url, init))
    renderTask()
    const article = (await screen.findByText('Уточнення до завдання')).closest('.task-comment')!
    expect(article.parentElement).toHaveClass('task-comment-row')
    expect(article.querySelectorAll('.task-comment__side-actions > button')).toHaveLength(2)
    expect(article.querySelector('.task-comment__bubble .message-like-button')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Подобається' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments/nearby/reactions', expect.objectContaining({ method: 'POST' })))
    fireEvent.click(screen.getByRole('button', { name: 'Відповісти' }))
    expect(screen.getByText('Відповідь: Анна')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Коментар до завдання' })).toHaveFocus()
    fireEvent.change(screen.getByRole('textbox', { name: 'Коментар до завдання' }), { target: { value: 'Моя відповідь' } })
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments', expect.objectContaining({
      body: expect.stringContaining('"replyToCommentId":"nearby"'),
    })))
  })

  it.each([false, true])('keeps existing side likes visible with their original liked=%s state', async (likedByMe) => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, comments: [{
        id: 'liked', author: user, body: 'Вподобаний коментар', createdAt: task.createdAt,
        attachments: [], mentions: [], replyToCommentId: null, replyPreview: null,
        reactions: { likeCount: 2, likedByMe },
      }] }) : original(url, init))
    renderTask()
    const article = (await screen.findByText('Вподобаний коментар')).closest('.task-comment')!
    const like = article.querySelector('.task-comment__side-actions .message-like-button')!
    expect(like).toHaveAttribute('aria-pressed', String(likedByMe))
    expect(like.classList.contains('is-mine')).toBe(likedByMe)
    expect(like).not.toHaveClass('task-comment__reveal-action')
    expect(like).toHaveTextContent('2')
    expect(article.querySelector('.task-comment__bubble .message-like-button')).toBeNull()
  })

  it.each([
    ['application/msword', 'Word'], ['application/vnd.ms-excel', 'Excel'], ['application/vnd.ms-powerpoint', 'PowerPoint'],
    ['application/pdf', 'PDF'], ['application/octet-stream', 'PDF'],
  ])('uses the shared %s icon in task materials and comments', async (mimeType, name) => {
    const original = request.getMockImplementation()!
    const office = { ...attachment, fileName: name === 'PDF' ? 'Звіт.pdf' : name, mimeType }
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, attachments: [office], comments: [{
        id: 'office-comment', author: user, body: '', createdAt: task.createdAt, attachments: [office],
        mentions: [], replyToCommentId: null, replyPreview: null, reactions: { likeCount: 0, likedByMe: false },
      }] }) : original(url, init))
    renderTask()
    expect(await screen.findByRole('img', { name: `Формат ${name}` })).toHaveClass(`file-format-icon--${name === 'PDF' ? 'pdf' : 'office'}`)
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

  it.each(['', '   \n  ', 'Пояснення до файла'])('shows task attachments without a blank text row and preserves captions (%j)', async (body) => {
    const initialRequest = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, comments: [{
        id: 'comment_pdf', author: user, body, createdAt: task.createdAt,
        attachments: [{ ...attachment, fileName: 'Звіт.pdf', mimeType: 'application/pdf' }],
        mentions: [], replyToCommentId: null, replyPreview: null,
        reactions: { likeCount: 0, likedByMe: false },
      }] }) : initialRequest(url, init))
    renderTask()
    const open = await screen.findByRole('button', { name: 'Переглянути Звіт.pdf' })
    expect(open).toHaveClass('task-attachment', 'is-compact')
    expect(open).toHaveTextContent('Звіт.pdf')
    expect(open.closest('.task-comment-attachments')).not.toBeNull()
    const text = open.closest('.task-comment__bubble')!.querySelector('.formatted-text')
    if (body.trim()) expect(text).toHaveTextContent(body)
    else expect(text).toBeNull()
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

  it('uses the refreshed task verdict instead of a stale disabled SCANNING query', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/files/file_1/status'
      ? Promise.resolve({ scanStatus: 'SCANNING' }) : original(url, init))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['task', 'task_1'], { ...task, attachments: [{ ...attachment, scanStatus: 'QUARANTINED' }] })
    renderTask(client)
    fireEvent.click(await screen.findByText('Матеріали'))
    await waitFor(() => expect(client.getQueryData(['file-status', 'file_1'])).toEqual({ scanStatus: 'SCANNING' }))
    expect(screen.getByText('Перевіряється')).toBeInTheDocument()
    await act(async () => { client.setQueryData(['task', 'task_1'], { ...task, attachments: [attachment] }) })
    await waitFor(() => expect(screen.queryByText('Перевіряється')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Переглянути Фото.jpg' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: 'Завантажити все одним архівом' })).not.toBeInTheDocument()
  })

  it('refreshes the checking label and archive availability together without reloading the task', async () => {
    const original = request.getMockImplementation()!
    let checks = 0
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/tasks/task_1') return Promise.resolve({ ...task, comments: [{
        id: 'pending-comment', author: user, body: 'Вкладення на перевірці', createdAt: task.createdAt,
        attachments: [{ ...attachment, scanStatus: 'QUARANTINED' }, { ...attachment, id: 'file_2', fileName: 'Фото2.jpg' }], mentions: [],
        replyToCommentId: null, replyPreview: null, reactions: { likeCount: 0, likedByMe: false },
      }] })
      if (url === '/files/file_1/status') return Promise.resolve({ scanStatus: ++checks === 1 ? 'SCANNING' : 'CLEAN' })
      return original(url, init)
    })
    renderTask()
    await screen.findByText('Перевіряється')
    expect(screen.getByText('Архів буде доступний після перевірки всіх файлів')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Переглянути Фото.jpg' })).toBeEnabled(), { timeout: 5000 })
    expect(screen.queryByText('Перевіряється')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Завантажити все одним архівом' })).toHaveAttribute('href', '/api/v1/files/archive?ids=file_1%2Cfile_2')
    expect(request.mock.calls.filter(([url]) => url === '/tasks/task_1')).toHaveLength(1)
  })

  it.each(['INFECTED', 'UNSUPPORTED', 'FAILED'])('keeps the file and archive blocked after %s', async (scanStatus) => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/tasks/task_1') return Promise.resolve({ ...task, attachments: [{ ...attachment, scanStatus: 'QUARANTINED' }, { ...attachment, id: 'file_2', fileName: 'Фото2.jpg' }] })
      if (url === '/files/file_1/status') return Promise.resolve({ scanStatus })
      return original(url, init)
    })
    renderTask()
    fireEvent.click(await screen.findByText('Матеріали'))
    await screen.findByText('Архів недоступний: не всі файли пройшли перевірку')
    expect(screen.queryByRole('button', { name: 'Переглянути Фото.jpg' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Завантажити все одним архівом' })).not.toBeInTheDocument()
    expect(screen.queryByText('Перевіряється')).not.toBeInTheDocument()
  })

  it('pastes a clipboard image as a draft attachment and sends it with the comment', async () => {
    renderTask()
    const input = await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' })
    expect(fireEvent.paste(input, { clipboardData: { files: [image] } })).toBe(false)
    await screen.findByRole('button', { name: 'Прибрати Фото.jpg з коментаря' })
    const upload = request.mock.calls.find(([url]) => url === '/tasks/task_1/attachments?draft=true')!
    expect((upload[1].body as FormData).get('file')).toBe(image)
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/comments')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/tasks/task_1/comments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ body: '', mentions: [], replyToCommentId: null, attachmentIds: ['file_1'] }),
    })))
  })

  it('keeps ordinary text paste available without uploading files', async () => {
    renderTask()
    const input = await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    expect(fireEvent.paste(input, { clipboardData: { files: [], getData: () => 'Текст із буфера' } })).toBe(true)
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/attachments?draft=true')).toBe(false)
  })

  it('limits pasted attachments to five and ignores further files', async () => {
    const original = request.getMockImplementation()!
    let uploads = 0
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1/attachments?draft=true'
      ? Promise.resolve({ ...attachment, id: `pasted_${++uploads}`, fileName: `Фото${uploads}.jpg` }) : original(url, init))
    renderTask()
    const input = await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    const files = Array.from({ length: 6 }, (_, index) => new File(['image'], `${index}.png`, { type: 'image/png' }))
    fireEvent.paste(input, { clipboardData: { files } })
    await screen.findByRole('button', { name: 'Прибрати Фото5.jpg з коментаря' })
    fireEvent.paste(input, { clipboardData: { files: [files[0]] } })
    expect(uploads).toBe(5)
  })

  it('does not upload pasted files without attachment permission', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation((url: string, init?: RequestInit) => url === '/tasks/task_1'
      ? Promise.resolve({ ...task, canAttachFiles: false }) : original(url, init))
    renderTask()
    const input = await screen.findByRole('textbox', { name: 'Коментар до завдання' })
    fireEvent.paste(input, { clipboardData: { files: [new File(['image'], 'screenshot.png', { type: 'image/png' })] } })
    expect(request.mock.calls.some(([url]) => url === '/tasks/task_1/attachments?draft=true')).toBe(false)
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
