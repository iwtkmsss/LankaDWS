import type { ChatMessageView, ChatThreadDetail } from '@lankadws/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../shared/api/client'
import { OverlayProvider } from '../shared/ui'
import { getMessage, getMessagePage, getThreadDetail, getThreadPage, sendMessage, setMessageReaction } from '../features/messages/api/messageApi'
import { messageKeys } from '../features/messages/api/messageKeys'
import { RightCommunicationPanel } from './RightCommunicationPanel'

vi.mock('../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))
vi.mock('../shared/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/api/client')>(),
  api: vi.fn().mockResolvedValue({}),
}))
vi.mock('../features/messages/api/messageApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../features/messages/api/messageApi')>(),
  getMessage: vi.fn(),
  getMessagePage: vi.fn(),
  getThreadPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, counts: { all: 0, unread: 0 } }),
  getThreadDetail: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({ id: 'sent-1' }),
  setMessageReaction: vi.fn(),
}))

const message: ChatMessageView = {
  id: 'message-1', authorId: 'user-1', body: 'Перевірка меню',
  createdAt: '2026-10-06T10:00:00Z', editedAt: null, deletedAt: null,
  version: 1, replyToId: null, replyPreview: null, mentions: [], attachments: [],
  author: { id: 'user-1', displayName: 'Марія', avatarAsset: null },
  readByCount: 0, reactions: { likeCount: 0, likedByMe: false },
  canEdit: true, canDelete: true,
}

const thread: ChatThreadDetail = {
  id: 'thread-1', companyId: 'company-1', kind: 'GROUP', title: 'Тестовий діалог',
  participants: [], canPost: true, lastReadMessageId: null, lastMessageId: null,
  version: 1, notificationMode: 'ALL', participantVersion: 1, canManageParticipants: false, canLeave: true,
}

async function openPanel(overrides: Partial<ChatMessageView> = {}, conversation: ChatThreadDetail = thread, olderMessages: ChatMessageView[] = []) {
  const target = { ...message, ...overrides }
  const page = { items: [...olderMessages, target], olderCursor: null, newerCursor: null }
  vi.mocked(getMessagePage).mockResolvedValue(page)
  vi.mocked(getThreadDetail).mockResolvedValue(conversation)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(messageKeys.threads('all', false), {
    pages: [{ items: [{ id: 'thread-1', kind: conversation.kind, title: conversation.title, unreadCount: 0 }], nextCursor: null }],
    pageParams: [null],
  })
  client.setQueryData(messageKeys.detail('thread-1'), conversation)
  client.setQueryData(messageKeys.pages('thread-1'), { pages: [page], pageParams: [null] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createMemoryRouter([{ path: '/', element: <OverlayProvider>
        <RightCommunicationPanel chatUnread={0} notificationUnread={0} targetUserId={null}
          onClearTarget={vi.fn()} onClose={vi.fn()} />
      </OverlayProvider> }])} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: conversation.kind === 'DIRECT' ? /^Петренко Олена/ : /^Тестовий діалог/ }))
  await screen.findByText(target.body)
  fireEvent.contextMenu(screen.getByText(target.body), { clientX: 200, clientY: 100 })
  return client
}

describe('RightCommunicationPanel notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  function renderNotifications(entityType = 'DOCUMENT', entry = '/') {
    const item = {
      id: 'notification-1', category: 'DRIVE', safeTitle: 'Вам відкрито доступ',
      safeSnippet: 'Колега надав доступ для перегляду.', entityType, entityId: 'doc/one',
      readAt: null, requiresAction: false, createdAt: '2026-10-20T10:00:00Z',
    }
    vi.mocked(api).mockResolvedValue({ items: [item] })
    const router = createMemoryRouter([
      { path: '/', element: <OverlayProvider>
        <RightCommunicationPanel chatUnread={0} notificationUnread={1} targetUserId={null}
          onClearTarget={vi.fn()} onClose={vi.fn()} />
      </OverlayProvider> },
      { path: '/drive', element: <div>Диск</div> },
      { path: '/drive/:documentId', element: <div>Файл</div> },
    ], { initialEntries: [entry] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>)
    if (entry === '/') fireEvent.click(screen.getByRole('tab', { name: /Сповіщення/ }))
    return router
  }

  it.each([
    ['DOCUMENT', '/drive/doc%2Fone', ''],
    ['DRIVE_FOLDER', '/drive', '?folder=doc%2Fone'],
  ])('opens %s access notifications from the right panel', async (entityType, pathname, search) => {
    const router = renderNotifications(entityType)
    fireEvent.click(await screen.findByRole('button', { name: /Вам відкрито доступ/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname))
    expect(router.state.location.search).toBe(search)
  })

  it('keeps background scrolling available while the panel is open and after it closes', async () => {
    const router = renderNotifications()
    const panel = screen.getByRole('complementary', { name: 'Чат і сповіщення' })
    expect(document.documentElement).not.toHaveClass('right-panel-scroll-lock')
    expect(fireEvent.wheel(document.body, { deltaY: 100 })).toBe(true)
    expect(fireEvent.touchMove(document.body)).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'PageDown' })).toBe(true)
    expect(fireEvent.wheel(panel, { deltaY: 100 })).toBe(true)
    expect(fireEvent.touchMove(panel)).toBe(true)
    expect(fireEvent.keyDown(panel, { key: 'PageDown' })).toBe(true)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    expect(fireEvent.wheel(dialog, { deltaY: 100 })).toBe(true)
    dialog.remove()
    fireEvent.click(await screen.findByRole('button', { name: /Вам відкрито доступ/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/drive/doc%2Fone'))
    expect(document.documentElement).not.toHaveClass('right-panel-scroll-lock')
    expect(fireEvent.wheel(document.body, { deltaY: 100 })).toBe(true)
    expect(fireEvent.touchMove(document.body)).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'PageDown' })).toBe(true)
  })

  it('separates new notifications from earlier ones only when both exist', async () => {
    const base = { category: 'TASKS', safeSnippet: 'Задача', entityType: 'TASK', entityId: 'task', requiresAction: false, createdAt: '2026-10-20T10:00:00Z' }
    renderNotifications()
    vi.mocked(api).mockResolvedValue({ items: [
      { ...base, id: 'unread', safeTitle: 'Нове сповіщення', readAt: null },
      { ...base, id: 'read', safeTitle: 'Старе сповіщення', readAt: '2026-10-21T10:00:00Z' },
    ] })
    fireEvent.click(screen.getByRole('tab', { name: 'Згадки' }))
    expect(await screen.findByRole('heading', { name: 'Нові' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Раніше' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Прочитати згадки' })).toBeVisible()
    vi.mocked(api).mockResolvedValue({ items: [{ ...base, id: 'unread', safeTitle: 'Нове сповіщення', readAt: null }] })
    fireEvent.click(screen.getByRole('tab', { name: 'Непрочитані' }))
    await screen.findByRole('button', { name: 'Прочитати всі' })
    expect(screen.queryByRole('heading', { name: 'Нові' })).not.toBeInTheDocument()
  })

  it('names what is missing when a filter is empty', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] })
    renderNotifications()
    vi.mocked(api).mockResolvedValue({ items: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Згадки' }))
    expect(await screen.findByText('Згадок немає')).toBeVisible()
  })

  it('marks a notification read when it is opened, whatever its source', async () => {
    renderNotifications('EVENT')
    fireEvent.click(await screen.findByRole('button', { name: /Вам відкрито доступ/ }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ read: true }),
    }))
  })

  it('filters and marks notifications read without linking to the removed page', async () => {
    renderNotifications()
    await screen.findByText('Вам відкрито доступ')
    expect(screen.queryByRole('link', { name: /Усі сповіщення/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Непрочитані' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications?tab=unread'))
    fireEvent.click(await screen.findByRole('button', { name: 'Позначити прочитаним' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ read: true }),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Прочитати всі' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/read-all', {
      method: 'PATCH', body: JSON.stringify({ tab: 'unread' }),
    }))
  })

  it('opens notifications through a dashboard link even when chat was selected', async () => {
    window.localStorage.setItem('lankadws.right-panel.tab', 'chat')
    renderNotifications('DOCUMENT', '/?panel=notifications')
    expect(await screen.findByText('Вам відкрито доступ')).toBeVisible()
    expect(screen.getByRole('tab', { name: /Сповіщення/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('RightCommunicationPanel message actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api).mockResolvedValue({})
    window.localStorage.clear()
    window.sessionStorage.clear()
    HTMLElement.prototype.scrollTo = vi.fn()
    vi.mocked(sendMessage).mockResolvedValue({ ...message, id: 'sent-1' })
  })

  it('keeps attachments local until Send and removes them without a server delete', async () => {
    await openPanel()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['data'], 'local.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('button', { name: 'Прибрати local.txt' })).toBeVisible()
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.includes('/attachments'))).toHaveLength(0)
    expect(sendMessage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати local.txt' }))
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.includes('/draft'))).toHaveLength(0)
    fireEvent.change(input, { target: { files: [new File(['data'], 'local.txt', { type: 'text/plain' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('thread-1', expect.objectContaining({ attachmentIds: [expect.stringMatching(/^local-attachment:/)] }), expect.any(String), [expect.objectContaining({ fileName: 'local.txt' })]))
  })

  it('uses the same photo thumbnails and document format icons in messages and chat files', async () => {
    await openPanel({ attachments: [
      { id: 'photo', fileName: 'photo.png', mimeType: 'image/png', bytes: 10, scanStatus: 'CLEAN' },
      { id: 'pdf', fileName: 'report.pdf', mimeType: 'application/pdf', bytes: 10, scanStatus: 'CLEAN' },
      { id: 'txt', fileName: 'notes.txt', mimeType: 'text/plain', bytes: 10, scanStatus: 'CLEAN' },
    ] }, { ...thread, kind: 'DIRECT', title: 'Петренко Олена', participants: [
      { id: 'user-2', displayName: 'Петренко Олена', username: 'olena', jobTitle: '', avatarAsset: null, role: 'MEMBER', version: 1 },
    ] })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Формат PDF' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Формат TXT' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Файли в чаті/ }))
    const grid = document.querySelector('.right-panel__chat-files-grid') as HTMLElement
    expect(screen.queryByRole('region', { name: 'Коротка інформація про користувача' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('img', { name: 'photo.png' })).toBeVisible()
    expect(within(grid).getByRole('img', { name: 'Формат PDF' })).toBeVisible()
    expect(within(grid).getByRole('img', { name: 'Формат TXT' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Файли в чаті/ }))
    expect(screen.getByText(message.body)).toBeVisible()
  })

  it('opens an empty file list in a group chat and returns to messages', async () => {
    await openPanel()
    fireEvent.keyDown(window, { key: 'Escape' })
    const toggle = screen.getByRole('button', { name: 'Файли в чаті' })
    fireEvent.click(toggle)
    expect(screen.getByText('У цьому чаті ще немає файлів.')).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(screen.getByText(message.body)).toBeVisible()
  })

  it('expands files with the keyboard and restores profile information when reopened', async () => {
    await openPanel({ attachments: [
      { id: 'pdf', fileName: 'report.pdf', mimeType: 'application/pdf', bytes: 10, scanStatus: 'CLEAN' },
    ] }, { ...thread, kind: 'DIRECT', title: 'Петренко Олена', participants: [
      { id: 'user-2', displayName: 'Петренко Олена', username: 'olena', jobTitle: '', avatarAsset: null, role: 'MEMBER', version: 1 },
    ] })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Розгорнути інформацію про користувача' }))
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Файли в чаті/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: /Файли в чаті/ }))
    const separator = screen.getByRole('separator', { name: 'Змінити розмір блоку файлів' })
    expect(separator).toBeVisible()
    const profile = document.querySelector('.right-panel__resizable-profile') as HTMLElement
    Object.defineProperty(profile, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(profile.firstElementChild, 'clientHeight', { configurable: true, value: 200 })
    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    expect(profile.style.maxHeight).toBe('168px')
    expect(screen.getByRole('button', { name: /Файли в чаті/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(Number.parseFloat(profile.style.maxHeight)).toBe(0)
    expect(profile).toHaveAttribute('inert')
    expect(separator).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('button', { name: /Файли в чаті/ })).toBeVisible()
    fireEvent.keyDown(separator, { key: 'End' })
    expect(profile.style.maxHeight).toBe('200px')
    expect(profile).not.toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: /Файли в чаті/ }))
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Файли в чаті/ }))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '0')
    expect((document.querySelector('.right-panel__resizable-profile') as HTMLElement).style.maxHeight).toBe('')
  })

  it('shows the author only at the start of consecutive incoming mini-chat messages', async () => {
    const author = { id: 'user-2', displayName: 'Олена', avatarAsset: null }
    await openPanel({ authorId: author.id, author }, thread, [{
      ...message, id: 'older-message', authorId: author.id, author, body: 'Попереднє повідомлення',
      createdAt: '2026-10-06T09:59:00Z',
    }])
    expect(document.querySelector('#right-panel-message-older-message .message-bubble__author')).toHaveTextContent('Олена')
    expect(document.querySelector('#right-panel-message-message-1 .message-bubble__author')).toBeNull()
    expect(document.querySelector('#right-panel-message-older-message a.message-author-avatar')).toBeNull()
    expect(document.querySelector('#right-panel-message-message-1 a.message-author-avatar')).not.toBeNull()
    expect(document.querySelectorAll('.right-panel__message-list time')).toHaveLength(2)
  })

  it('shows the unsent draft in the mini-chat list and restores it when reopened', async () => {
    await openPanel()
    fireEvent.change(screen.getByRole('textbox', { name: 'Повідомлення' }), { target: { value: 'Текст чернетки' } })
    fireEvent.click(screen.getByRole('button', { name: 'До списку діалогів' }))
    expect(await screen.findByText('Чернетка:')).toHaveClass('message-draft-label')
    expect(screen.getByText(/Текст чернетки/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Тестовий діалог/ }))
    expect(await screen.findByRole('textbox', { name: 'Повідомлення' })).toHaveValue('Текст чернетки')
  })

  it('shows the patronymic in the existing tag line and shortens the direct-chat name', async () => {
    await openPanel({}, {
      ...thread, kind: 'DIRECT', title: 'Петренко Олена Іванівна',
      participants: [{ id: 'user-2', displayName: 'Петренко Олена Іванівна', username: 'olena', jobTitle: '', avatarAsset: null, role: 'MEMBER', version: 1 }],
    })
    const header = document.querySelector('.right-panel__conversation-header')!
    expect(within(header as HTMLElement).getByText('Петренко Олена')).toBeVisible()
    expect(within(header as HTMLElement).getByText('Іванівна').tagName).toBe('SMALL')
    expect(within(header as HTMLElement).queryByText('@olena')).not.toBeInTheDocument()
    expect(screen.queryByText('Петренко Олена Іванівна')).not.toBeInTheDocument()
  })

  it('adds and removes a like through the shared message cache', async () => {
    vi.mocked(setMessageReaction).mockResolvedValueOnce({ ...message, reactions: { likeCount: 1, likedByMe: true } })
      .mockResolvedValueOnce(message)
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Подобається' }))
    await waitFor(() => expect(setMessageReaction).toHaveBeenCalledWith(message.id, true))
    const unlike = await screen.findByRole('button', { name: 'Прибрати вподобання' })
    expect(unlike).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(unlike)
    await waitFor(() => expect(setMessageReaction).toHaveBeenCalledWith(message.id, false))
  })

  it('sends a reply with the selected message id', async () => {
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Відповісти' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Моя відповідь' } })
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('thread-1', {
      body: 'Моя відповідь', mentions: [], attachmentIds: [], replyToId: message.id,
    }, expect.any(String), []))
  })

  it('shows only this thread unread count while scrolled up and reads on returning to the bottom', async () => {
    const client = await openPanel()
    fireEvent.keyDown(window, { key: 'Escape' })
    const viewport = document.querySelector('.right-panel__messages') as HTMLDivElement
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    })
    fireEvent.wheel(viewport, { deltaY: -100 })
    fireEvent.scroll(viewport)
    const incoming = { ...message, id: 'incoming-1', authorId: 'user-2', body: 'Нове повідомлення' }
    client.setQueryData(messageKeys.pages('thread-1'), {
      pages: [{ items: [message, incoming], olderCursor: null, newerCursor: null }], pageParams: [null],
    })
    client.setQueryData(messageKeys.detail('thread-1'), { ...thread, lastMessageId: incoming.id })
    client.setQueryData(messageKeys.threads('all', false), {
      pages: [{ items: [
        { id: 'thread-1', kind: 'GROUP', title: thread.title, unreadCount: 3 },
        { id: 'thread-2', kind: 'GROUP', title: 'Інший діалог', unreadCount: 8 },
      ], nextCursor: null }], pageParams: [null],
    })
    const bottom = await screen.findByRole('button', { name: 'До нових повідомлень: 3 непрочитаних' })
    expect(within(bottom).getByText('3')).toBeInTheDocument()
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/messages/threads/thread-1/read')).toBe(false)
    fireEvent.click(bottom)
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' })
    viewport.scrollTop = 800
    fireEvent.scroll(viewport)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/messages/threads/thread-1/read', {
      method: 'POST', body: JSON.stringify({ lastReadMessageId: incoming.id }),
    }))
    expect(screen.queryByRole('button', { name: /До нових повідомлень/ })).toBeNull()
  })

  it('scrolls to the latest message after sending from older history', async () => {
    await openPanel()
    fireEvent.keyDown(window, { key: 'Escape' })
    const viewport = document.querySelector('.right-panel__messages') as HTMLDivElement
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    })
    fireEvent.wheel(viewport, { deltaY: -100 })
    fireEvent.scroll(viewport)
    expect(screen.getByRole('button', { name: 'До нових повідомлень' })).toBeInTheDocument()
    vi.mocked(viewport.scrollTo).mockClear()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Нове повідомлення' } })
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' }))
  })

  it('renders the menu outside the animated panel and keeps it open on menu pointerdown', async () => {
    await openPanel()
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    fireEvent.pointerDown(within(menu).getByRole('button', { name: 'Подобається' }))
    expect(screen.getByRole('menu')).toBe(menu)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(screen.getByText(message.body))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('deletes with the expected version and displays the returned tombstone', async () => {
    vi.mocked(getMessage).mockResolvedValue({ ...message, deletedAt: '2026-10-06T11:00:00Z' })
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Видалити' }))
    await screen.findByText('Повідомлення видалено')
    expect(api).toHaveBeenCalledWith('/messages/message-1', {
      method: 'DELETE', body: JSON.stringify({ expectedVersion: 1 }),
    })
  })

  it('hides edit and delete when the server disallows them', async () => {
    await openPanel({ canEdit: false, canDelete: false })
    expect(within(screen.getByRole('menu')).queryByRole('button', { name: 'Редагувати' })).toBeNull()
    expect(within(screen.getByRole('menu')).queryByRole('button', { name: 'Видалити' })).toBeNull()
  })

  it('saves edited text with the expected version', async () => {
    vi.mocked(getMessage).mockResolvedValue({ ...message, body: 'Змінений текст', version: 2 })
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Редагувати' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст повідомлення' }), { target: { value: 'Змінений текст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }))
    await screen.findByText('Змінений текст')
    expect(api).toHaveBeenCalledWith('/messages/message-1', {
      method: 'PATCH', body: JSON.stringify({ body: 'Змінений текст', mentions: [], expectedVersion: 1 }),
    })
  })

  it('opens the existing forwarding drawer', async () => {
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Переслати' }))
    await waitFor(() => expect(getThreadPage).toHaveBeenCalledWith('all', false, null, expect.any(AbortSignal)))
    expect(await screen.findByRole('button', { name: /^Тестовий діалог/ })).toBeInTheDocument()
  })

  it('allows forwarding into the current conversation', async () => {
    vi.mocked(getThreadPage).mockResolvedValueOnce({ items: [{
      id: thread.id, companyId: thread.companyId, title: thread.title, kind: thread.kind,
      avatarAsset: null, previewParticipants: [], participantCount: 2,
      lastMessageAt: message.createdAt, lastMessage: message.body, lastMessageId: message.id,
      unread: false, unreadCount: 0, notificationMode: 'ALL',
    }], nextCursor: null, counts: { all: 1, unread: 0 } })
    await openPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Переслати' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Тестовий діалог/ }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(thread.id, {
      body: `Переслано від Марія:\n${message.body}`, attachmentIds: [], mentions: [],
    }, expect.any(String)))
  })
})
