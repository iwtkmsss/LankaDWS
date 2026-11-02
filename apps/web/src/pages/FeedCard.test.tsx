import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPostView } from '@lankadws/contracts'
import { api } from '../shared/api/client'
import { OverlayProvider } from '../shared/ui'
import { FeedCard } from './FeedPage'

vi.mock('../shared/api/client', async (original) => ({ ...await original<typeof import('../shared/api/client')>(), api: vi.fn() }))

const item: FeedPostView = {
  kind: 'POST', id: 'post', itemId: 'feed-post', companyId: 'company',
  author: { id: 'author', displayName: 'Марія Іваненко', avatarAsset: null },
  audienceLabel: 'Усі', body: 'Оновлення команди', mentions: [], status: 'PUBLISHED',
  requiresAcknowledgement: true, acknowledgementVersion: 3, acknowledgementRequiredForMe: true,
  hasAcknowledged: false, acknowledgementCount: 0, acknowledgementRecipientCount: 2,
  likedByMe: false, likeCount: 0, commentCount: 0, comments: [], attachments: [],
  publishedAt: '2026-10-29T08:00:00Z', editedAt: null, version: 4, canEdit: true, canModerate: false,
}

function mount(value = item, viewerId = 'reader') {
  const changed = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter><OverlayProvider>
    <FeedCard item={value} viewerId={viewerId} isNew loadedAt={0} onChanged={changed} />
  </OverlayProvider></MemoryRouter></QueryClientProvider>)
  return changed
}

beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:photo')
    static revokeObjectURL = vi.fn()
  })
  vi.mocked(api).mockResolvedValue({})
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('FeedCard production actions', () => {
  it('adds editor photos to the versioned save and keeps them when saving fails', async () => {
    const changed = mount()
    vi.mocked(api).mockImplementation(async (path) => path.startsWith('/feed/attachments?')
      ? { id: 'photo', fileName: 'screen.png', bytes: 5, mimeType: 'image/png', scanStatus: 'QUARANTINED' } : {})
    fireEvent.click(screen.getByRole('button', { name: 'Дії з записом' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }))
    expect(screen.getByRole('button', { name: 'Вставити фото' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Фото до публікації'), { target: { files: [new File(['image'], 'screen.png', { type: 'image/png' })] } })
    await screen.findByRole('button', { name: 'Прибрати screen.png' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Зберегти зміни' })).toBeEnabled())
    expect(api).toHaveBeenCalledWith('/feed/attachments?company=company', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }))
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося зберегти зміни')
    expect(screen.getByRole('button', { name: 'Прибрати screen.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(api).toHaveBeenCalledWith('/feed/post', expect.objectContaining({ body: JSON.stringify({ body: item.body, mentions: [], expectedVersion: 4, attachmentIds: ['photo'] }) }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  }, 15_000)

  it('disables adding editor photos when the publication already has five', () => {
    mount({ ...item, attachments: Array.from({ length: 5 }, (_, index) => ({ id: `photo_${index}`, fileName: `photo_${index}.png`, bytes: 5, mimeType: 'image/png', scanStatus: 'QUARANTINED' })) })
    fireEvent.click(screen.getByRole('button', { name: 'Дії з записом' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }))
    expect(screen.getByRole('button', { name: 'Вставити фото' })).toBeDisabled()
  })

  it('renders placed photos inside the text block instead of the attachment list', () => {
    const photo = { id: 'photo', fileName: 'схема.png', bytes: 5, mimeType: 'image/png', scanStatus: 'CLEAN' as const }
    const file = { id: 'doc', fileName: 'план.pdf', bytes: 5, mimeType: 'application/pdf', scanStatus: 'CLEAN' as const }
    const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OverlayProvider>
      <FeedCard item={{ ...item, attachments: [photo, file], photoLayout: [{ fileId: 'photo', x: .25, y: .1, width: .5, height: .25 }] }} viewerId="reader" isNew={false} loadedAt={0} onChanged={vi.fn()} />
    </OverlayProvider></MemoryRouter></QueryClientProvider>)
    const placed = container.querySelector<HTMLElement>('.feed-inline-canvas__photo')!
    expect(within(placed).getByRole('button', { name: 'Переглянути схема.png' })).toBeEnabled()
    expect(placed.style.getPropertyValue('--x')).toBe('0.25')
    const attachments = screen.getByRole('region', { name: 'Вкладення' })
    expect(within(attachments).getByText('Вкладення · 1')).toBeInTheDocument()
    expect(within(attachments).queryByText('схема.png')).not.toBeInTheDocument()
  })

  it('does not offer personal pinning for publications', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Дії з записом' }))
    expect(screen.queryByRole('menuitem', { name: 'Закріпити для себе' })).not.toBeInTheDocument()
  })

  it('uses real profile links, reactions and versioned acknowledgements with the shared design', async () => {
    const changed = mount()
    expect(screen.getByText('Нове оновлення')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Відкрити профіль Марія Іваненко' })).toHaveAttribute('href', '/?employeeId=author')
    expect(api).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Подобається' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(api).toHaveBeenCalledWith('/feed/post/reactions/like', { method: 'POST' })
    fireEvent.click(screen.getByRole('button', { name: 'Ознайомився' }))
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(api).toHaveBeenCalledWith('/feed/post/acknowledge', expect.objectContaining({ body: JSON.stringify({ acknowledgementVersion: 3 }) }))
  })

  it('uploads a photo and sends a photo-only comment, clearing the draft after success', async () => {
    const changed = mount()
    vi.mocked(api).mockImplementation(async (path) => path.endsWith('comment-attachments')
      ? { id: 'photo', fileName: 'screen.png', bytes: 5, mimeType: 'image/png', scanStatus: 'QUARANTINED' } : {})
    fireEvent.click(screen.getByRole('button', { name: 'Коментарі' }))
    fireEvent.change(screen.getByLabelText('Фото до коментаря'), { target: { files: [new File(['image'], 'screen.png', { type: 'image/png' })] } })
    await screen.findByRole('button', { name: 'Прибрати screen.png' })
    expect(api).toHaveBeenCalledWith('/feed/post/comment-attachments', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }))
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(api).toHaveBeenCalledWith('/feed/post/comments', expect.objectContaining({ body: JSON.stringify({ body: '', mentions: [], replyToCommentId: null, attachmentIds: ['photo'] }) }))
    expect(screen.queryByRole('button', { name: 'Прибрати screen.png' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled()
  })

  it('preserves a failed comment draft and sends replies to the real parent', async () => {
    mount({ ...item, commentCount: 1, comments: [{ id: 'parent', author: item.author, body: 'Запитання', mentions: [], createdAt: item.publishedAt, editedAt: null, replyToCommentId: null }] })
    fireEvent.click(screen.getByRole('button', { name: /Коментарі/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Відповісти' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Ваша відповідь' }), { target: { value: 'Відповідь' } })
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося надіслати коментар')
    expect(screen.getByRole('textbox', { name: 'Ваша відповідь' })).toHaveValue('Відповідь')
    expect(api).toHaveBeenCalledWith('/feed/post/comments', expect.objectContaining({ body: JSON.stringify({ body: 'Відповідь', mentions: [], replyToCommentId: 'parent', attachmentIds: [] }) }))
  })

  it('edits and archives through the canonical versioned mutations', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Дії з записом' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }))
    const editor = screen.getByRole('textbox', { name: 'Текст публікації' })
    editor.textContent = 'Оновлений текст'
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/feed/post', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: 'Оновлений текст', mentions: [], expectedVersion: 4 }) })))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Зберегти зміни' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Дії з записом' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Підтвердити' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/feed/post', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedVersion: 4 }) })))
  })
})
