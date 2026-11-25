import '@testing-library/jest-dom/vitest'
import type { ChatMessageView, ChatThreadDetail } from '@lankadws/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../shared/api/client'
import { OverlayProvider } from '../../../shared/ui'
import { NOTICE_EVENT, type NoticeDetail } from '../../../shared/ui/notify'
import { MessageBubble } from './MessageBubble'
import { ThreadInfoDrawer } from './ThreadInfoDrawer'

// Decision 2026-11-18: administrators see deleted messages in place and restore
// them; leaving or removing a participant can be undone from the notice.

vi.mock('../../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../../shared/api/client')>(),
  api: vi.fn(),
}))

function mount(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OverlayProvider><MemoryRouter>{ui}</MemoryRouter></OverlayProvider>
  </QueryClientProvider>)
}

const deleted: ChatMessageView = {
  id: 'message-1', authorId: 'user-1', body: '', createdAt: '2026-11-18T10:00:00.000Z', editedAt: null,
  deletedAt: '2026-11-18T10:05:00.000Z', version: 2, replyToId: null, mentions: [], replyPreview: null,
  author: { id: 'user-1', displayName: 'Марія', avatarAsset: null }, attachments: [], readByCount: 0,
  reactions: { likeCount: 0, likedByMe: false }, canEdit: false, canDelete: false,
}
const handlers = { onReply: vi.fn(), onLike: vi.fn(), onForward: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }

let notices: NoticeDetail[] = []
const capture = (event: Event) => { notices.push((event as CustomEvent<NoticeDetail>).detail) }
beforeEach(() => { notices = []; window.addEventListener(NOTICE_EVENT, capture) })
afterEach(() => { window.removeEventListener(NOTICE_EVENT, capture); cleanup(); vi.clearAllMocks() })

describe('deleted message', () => {
  it('stays a plain tombstone for participants', () => {
    mount(<MessageBubble threadId="thread-1" message={deleted} own={false} {...handlers} onRestore={vi.fn()} />)
    expect(screen.getByText('Повідомлення видалено')).toBeVisible()
    expect(screen.queryByText(/Видалено .*,/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Відновити/ })).not.toBeInTheDocument()
  })

  it('shows an administrator the hidden text, who deleted it and a restore action', async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined)
    const forAdmin = {
      ...deleted, body: 'Прихований текст', canRestore: true, deletedBy: { id: 'user-1', displayName: 'Марія' },
      attachments: [{ id: 'file', fileName: 'report.pdf', bytes: 10, mimeType: 'application/pdf', scanStatus: 'CLEAN' as const }],
    }
    mount(<MessageBubble threadId="thread-1" message={forAdmin} own={false} {...handlers} onRestore={onRestore} />)
    expect(screen.getByText('Прихований текст')).toBeVisible()
    expect(screen.getByText(/^Видалено Марія, /)).toBeVisible()
    expect(screen.getByText('report.pdf')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Відновити/ }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(forAdmin))
  })

  it('reports a refused restore inline', async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error('conflict'))
    mount(<MessageBubble threadId="thread-1" message={{ ...deleted, canRestore: true, deletedBy: null }} own={false} {...handlers} onRestore={onRestore} />)
    fireEvent.click(screen.getByRole('button', { name: /Відновити/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося відновити')
  })
})

const thread: ChatThreadDetail = {
  id: 'thread-1', companyId: 'company', title: 'Група', kind: 'GROUP', version: 7, notificationMode: 'ALL',
  participantVersion: 2, lastMessageId: null, lastReadMessageId: null, canPost: true, canManageParticipants: true, canLeave: true,
  participants: [
    { id: 'me', displayName: 'Я', username: 'me', jobTitle: '', avatarAsset: null, role: 'OWNER', version: 2 },
    { id: 'other', displayName: 'Колега', username: 'other', jobTitle: '', avatarAsset: null, role: 'OWNER', version: 4 },
    { id: 'third', displayName: 'Третій', username: 'third', jobTitle: '', avatarAsset: null, role: 'MEMBER', version: 1 },
  ],
}

describe('participant undo', () => {
  it('rejoins after leaving with the participant version the leave produced', async () => {
    vi.mocked(api).mockResolvedValue({ userId: 'me', left: true, threadVersion: 8 })
    const onLeft = vi.fn()
    mount(<ThreadInfoDrawer thread={thread} currentUserId="me" onClose={vi.fn()} onLeft={onLeft} />)
    fireEvent.click(screen.getByRole('button', { name: /Вийти з діалогу/ }))
    await waitFor(() => expect(notices.at(-1)?.message).toBe('Ви вийшли з діалогу'))
    expect(onLeft).toHaveBeenCalled()
    await notices.at(-1)!.undo!()
    expect(api).toHaveBeenCalledWith('/messages/threads/thread-1/rejoin', { method: 'POST', body: JSON.stringify({ expectedVersion: 3 }) })
  })

  it('adds a removed participant back with the same role', async () => {
    vi.mocked(api).mockResolvedValue({ userId: 'third', left: true, threadVersion: 8 })
    mount(<ThreadInfoDrawer thread={thread} currentUserId="me" onClose={vi.fn()} onLeft={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Прибрати Третій/ }))
    await waitFor(() => expect(notices.at(-1)?.message).toBe('Учасника видалено'))
    await notices.at(-1)!.undo!()
    expect(api).toHaveBeenCalledWith('/messages/threads/thread-1/participants', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ userId: 'third', role: 'MEMBER', expectedThreadVersion: 8 }),
    }))
  })
})
