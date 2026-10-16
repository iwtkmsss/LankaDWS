import type { ChatMessageView } from '@lankadws/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from './MessageBubble'
import { OverlayProvider } from '../../../shared/ui'

function message(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'message-1',
    authorId: 'user-1',
    body: '',
    createdAt: '2026-08-31T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    version: 1,
    replyToId: null,
    mentions: [],
    replyPreview: null,
    author: { id: 'user-1', displayName: 'Марія', avatarAsset: null },
    attachments: [],
    readByCount: 0,
    reactions: { likeCount: 0, likedByMe: false },
    canEdit: true,
    canDelete: true,
    ...overrides,
  }
}

const handlers = {
  onReply: vi.fn(),
  onLike: vi.fn(),
  onForward: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

function renderAttachmentEditor(body = 'Текст') {
  const target = message({ body, attachments: [
    { id: 'photo', fileName: 'photo.png', bytes: 1024, mimeType: 'image/png', scanStatus: 'CLEAN' },
  ] })
  const onEdit = vi.fn().mockResolvedValue(undefined)
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <MessageBubble threadId="thread-1" message={target} own {...handlers} onEdit={onEdit} />
  </MemoryRouter></QueryClientProvider>)
  fireEvent.contextMenu(screen.getByRole('article'))
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))
  return { target, onEdit }
}

describe('MessageBubble', () => {
  it.each(['message', 'right-panel-message'])('keeps photo thumbnails beside document icons in %s', (idPrefix) => {
    render(<MemoryRouter><MessageBubble threadId="thread-1" idPrefix={idPrefix} own {...handlers}
      message={message({ attachments: [
        { id: 'photo', fileName: 'photo.png', mimeType: 'image/png', bytes: 10, scanStatus: 'CLEAN' },
        { id: 'pdf', fileName: 'report.pdf', mimeType: 'application/pdf', bytes: 10, scanStatus: 'CLEAN' },
        { id: 'txt', fileName: 'notes.txt', mimeType: 'text/plain', bytes: 10, scanStatus: 'CLEAN' },
      ] })} /></MemoryRouter>)
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', '/api/v1/files/photo/download?inline=true')
    expect(screen.getByRole('img', { name: 'Формат PDF' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Формат TXT' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Переглянути photo.png' })).toBeVisible()
  })

  it.each(['message', 'right-panel-message'])('opens clean PDFs from the attachment card in %s', (idPrefix) => {
    const { container } = render(<MemoryRouter>
      <MessageBubble threadId="thread-1" idPrefix={idPrefix} own {...handlers}
        message={message({ attachments: [{
          id: 'pdf-1', fileName: 'Звіт.pdf', bytes: 1024, mimeType: 'application/pdf', scanStatus: 'CLEAN',
        }] })} />
    </MemoryRouter>)
    const open = screen.getByRole('button', { name: 'Переглянути Звіт.pdf' })
    expect(open.parentElement).toBe(container.querySelector('.message-attachment'))
    const download = screen.getByRole('link', { name: 'Завантажити' })
    expect(download).toHaveAttribute('href', '/api/v1/files/pdf-1/download')
    expect(download.closest('.message-attachment__open')).toBeNull()
    expect(screen.getByRole('button', { name: 'Зберегти на Диск' }).closest('a')).toBeNull()
  })

  it.each([
    ['application/pdf', 'SCANNING'],
    ['application/pdf', 'QUARANTINED'],
    ['application/pdf', 'INFECTED'],
    ['application/zip', 'CLEAN'],
  ] as const)('offers preview only for clean attachments with %s and %s', (mimeType, scanStatus) => {
    render(<MemoryRouter>
      <MessageBubble threadId="thread-1" own {...handlers}
        message={message({ attachments: [{
          id: 'file-1', fileName: 'file', bytes: 1024, mimeType, scanStatus,
        }] })} />
    </MemoryRouter>)
    const preview = screen.queryByRole('button', { name: 'Переглянути file' })
    if (scanStatus === 'CLEAN') expect(preview).toBeInTheDocument()
    else expect(preview).not.toBeInTheDocument()
  })

  it('opens archives in the shared compact preview', () => {
    render(<OverlayProvider><MemoryRouter>
      <MessageBubble threadId="thread-1" own {...handlers} message={message({ attachments: [{
        id: 'zip-1', fileName: 'files.zip', bytes: 1024, mimeType: 'application/zip', scanStatus: 'CLEAN',
      }] })} />
    </MemoryRouter></OverlayProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути files.zip' }))
    expect(screen.getByRole('dialog', { name: 'files.zip' })).toHaveClass('file-preview-modal--compact')
  })

  it.each(['message', 'right-panel-message'])('keeps the edited marker directly before the time in %s', (idPrefix) => {
    const photo = { id: 'photo', fileName: 'photo.png', bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' as const }
    const variants = [[], [{ ...photo, mimeType: 'application/pdf', fileName: 'file.pdf' }],
      [photo, { ...photo, id: 'photo-2' }, { ...photo, id: 'photo-3' }]]
    const { container } = render(<MemoryRouter>{variants.map((attachments, index) =>
      <MessageBubble key={index} threadId="thread" idPrefix={idPrefix} own {...handlers}
        message={message({ id: `edited-${index}`, body: 'Текст повідомлення', editedAt: '2026-10-15T12:00:00Z', attachments })} />
    )}</MemoryRouter>)
    for (const bubble of container.querySelectorAll('.message-bubble')) {
      expect(bubble.querySelector('.message-bubble__content')).not.toHaveTextContent('змінено')
      const marker = bubble.querySelector('.message-bubble__meta .message-bubble__timestamp .message-bubble__edited')!
      expect(marker).toHaveTextContent('змінено')
      expect(marker.nextElementSibling?.tagName).toBe('TIME')
    }
  })

  it.each(['message', 'right-panel-message'])('navigates the selected album in %s', async (idPrefix) => {
    const attachments = [1, 2, 3].map((index) => ({
      id: `photo-${index}`, fileName: `${index}.png`, bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' as const,
    }))
    render(<QueryClientProvider client={new QueryClient()}><OverlayProvider><MemoryRouter>
      <MessageBubble threadId="thread" idPrefix={idPrefix} own {...handlers} message={message({ attachments })} />
    </MemoryRouter></OverlayProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути 2.png' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('img', { name: '2.png' })).toBeVisible()
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 / 3')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Збільшити' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Наступне фото' }))
    expect(within(dialog).getByRole('img', { name: '3.png' })).toHaveStyle({ transform: 'translate3d(0px, 0px, 0) scale(1)' })
    expect(within(dialog).getByRole('button', { name: 'Наступне фото' })).toBeDisabled()
    expect(within(dialog).getByRole('link', { name: 'Завантажити' })).toHaveAttribute('href', expect.stringContaining('/photo-3/download'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Попереднє фото' }))
    const stage = within(dialog).getByRole('group', { name: 'Область перегляду зображення' })
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    expect(within(dialog).getByRole('img', { name: '1.png' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Попереднє фото' })).toBeDisabled()
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 / 3')
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 / 3')
  })

  it.each(['message', 'right-panel-message'])('opens the chat menu instead of the browser menu on a photo in %s', (idPrefix) => {
    render(<MemoryRouter><MessageBubble threadId="thread" idPrefix={idPrefix} own {...handlers}
      message={message({ attachments: [
        { id: 'photo', fileName: 'photo.png', bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' },
      ] })} /></MemoryRouter>)
    expect(fireEvent.contextMenu(screen.getByRole('img', { name: 'photo.png' }), { clientX: 100, clientY: 100 })).toBe(false)
    expect(within(screen.getByRole('menu')).getByRole('button', { name: 'Переглянути фото' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each(['message', 'right-panel-message'])('groups photos in an album in %s', (idPrefix) => {
    const { container } = render(<MemoryRouter><MessageBubble threadId="thread" idPrefix={idPrefix} own {...handlers}
      message={message({ attachments: [1, 2, 3].map((index) => ({
        id: `photo-${index}`, fileName: `${index}.png`, bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN',
      })) })} /></MemoryRouter>)
    expect(container.querySelector('.message-attachments--album')).toHaveAttribute('data-photo-count', '3')
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })

  it('keeps mixed photo and document attachments outside an album with a photo thumbnail', () => {
    const { container } = render(<MemoryRouter><MessageBubble threadId="thread" own {...handlers}
      message={message({ attachments: [
        { id: 'photo', fileName: 'photo.png', bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' },
        { id: 'pdf', fileName: 'document.pdf', bytes: 10, mimeType: 'application/pdf', scanStatus: 'CLEAN' },
      ] })} /></MemoryRouter>)
    expect(container.querySelector('.message-attachments--album')).toBeNull()
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument()
    expect(screen.getByTitle('photo.png')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Завантажити' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Завантажити ZIP' })).toBeInTheDocument()
  })

  it('removes an attachment only after saving and restores it on cancel', async () => {
    const { target, onEdit } = renderAttachmentEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати вкладення photo.png' }))
    expect(screen.queryByRole('img', { name: 'photo.png' })).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('article'))
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))
    const article = screen.getByRole('article')
    const attachmentBlock = article.querySelector('.message-attachments')!
    const editor = article.querySelector('.message-bubble__edit')!
    expect(attachmentBlock.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(editor.querySelector('.message-bubble__edit-actions time')).toBeInTheDocument()
    expect(article.querySelectorAll('time')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Текст повідомлення' })).toHaveAttribute('rows', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати вкладення photo.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(target, 'Текст', [], []))
  })

  it('retains the edit draft after a failed save', async () => {
    const { onEdit } = renderAttachmentEditor()
    onEdit.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати вкладення photo.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося зберегти')
    expect(screen.getByRole('textbox', { name: 'Текст повідомлення' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'photo.png' })).not.toBeInTheDocument()
  })

  it('requires text before removing the last attachment from a file-only message', () => {
    renderAttachmentEditor('')
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати вкладення photo.png' }))
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст повідомлення' }), { target: { value: 'Замість фото' } })
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeEnabled()
  })

  it.each([2, 3])('puts only the ZIP link in the timestamp footer for %s attachments', (count) => {
    const { container } = render(<MemoryRouter><MessageBubble threadId="thread" own {...handlers}
      message={message({ attachments: Array.from({ length: count }, (_, index) => ({
        id: `file-${index}`, fileName: `photo-${index}.png`, bytes: 1024, mimeType: 'image/png', scanStatus: 'CLEAN',
      })) })} /></MemoryRouter>)
    const footer = container.querySelector('.message-bubble__meta') as HTMLElement
    expect(within(footer).getByRole('link', { name: 'Завантажити ZIP' })).toHaveAttribute('download')
    expect(footer.querySelector('time')).toBeInTheDocument()
    expect(container.querySelector('.message-attachments .message-attachments__archive')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Завантажити' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Зберегти на Диск' })).not.toBeInTheDocument()
  })
  it('restarts the target highlight on repeated reply clicks and removes it when finished', () => {
    const target = message({ id: 'original', body: 'Початкове повідомлення' })
    const reply = message({ id: 'reply', body: 'Відповідь', replyToId: target.id,
      replyPreview: { id: target.id, authorName: 'Марія', body: target.body } })
    const { container } = render(<MemoryRouter>
      <MessageBubble threadId="thread-1" message={target} own {...handlers} />
      <MessageBubble threadId="thread-1" message={reply} own {...handlers} />
    </MemoryRouter>)
    const original = container.querySelector('#message-original') as HTMLElement
    original.scrollIntoView = vi.fn()
    const quote = screen.getByRole('button', { name: /Марія\s*Початкове повідомлення/ })
    fireEvent.click(quote)
    const firstHighlight = original.querySelector('.message-bubble__reply-highlight')
    expect(firstHighlight).toBeInTheDocument()
    fireEvent.click(quote)
    const restartedHighlight = original.querySelector('.message-bubble__reply-highlight')
    expect(restartedHighlight).toBeInTheDocument()
    expect(restartedHighlight).not.toBe(firstHighlight)
    expect(original.scrollIntoView).toHaveBeenCalledTimes(2)
    fireEvent.animationEnd(restartedHighlight!)
    expect(original.querySelector('.message-bubble__reply-highlight')).toBeNull()
  })

  it('renders forwarded attribution separately in both chat variants', () => {
    const target = message({ body: 'Переслано від Аліна:\nдобре' })
    const { container } = render(<MemoryRouter>
      <MessageBubble threadId="thread-1" message={target} own {...handlers} />
      <MessageBubble threadId="thread-1" idPrefix="right-panel-message" message={target} own {...handlers} />
    </MemoryRouter>)
    expect(screen.getAllByLabelText('Переслано від Аліна')).toHaveLength(2)
    expect(container.querySelectorAll('.message-bubble__forwarded')).toHaveLength(2)
    expect(screen.getAllByText('добре')).toHaveLength(2)
    expect(container.querySelector('.message-bubble__content')).not.toHaveTextContent('Переслано від')
  })

  it('preserves mention positions after separating forwarded attribution', () => {
    const prefix = 'Переслано від Аліна:\n'
    render(<MemoryRouter><MessageBubble threadId="thread-1" own {...handlers}
      message={message({ body: `${prefix}Привіт @Марія`, mentions: [
        { userId: 'user-2', start: prefix.length + 7, end: prefix.length + 13, active: false },
      ] })} />
    </MemoryRouter>)
    expect(screen.getByText('@Марія')).toHaveClass('structured-mention')
  })

  it('shows read status for an own message', () => {
    const { container } = render(
      <MemoryRouter>
        <MessageBubble
          threadId="thread-1"
          message={message({ body: 'Вітаю', readByCount: 1 })}
          own
          {...handlers}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Прочитано')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble > .message-bubble__meta')).toBeInTheDocument()
  })

  it('starts a reply when the message is double-clicked', () => {
    const onReply = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble
          threadId="thread-1"
          message={target}
          own
          {...handlers}
          onReply={onReply}
        />
      </MemoryRouter>,
    )

    fireEvent.doubleClick(screen.getByText('Вітаю'))

    expect(onReply).toHaveBeenCalledWith(target)
  })

  it('marks a newly received message for the current chat session', () => {
    const { container } = render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={message({ body: 'Нове' })} own={false} isNew {...handlers} />
      </MemoryRouter>,
    )

    expect(container.querySelector('.message-row')).toHaveClass('is-new')
  })

  it('raises a like as a reaction on the message', () => {
    const onLike = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own {...handlers} onLike={onLike} />
      </MemoryRouter>,
    )

    fireEvent.contextMenu(screen.getByRole('article'))
    fireEvent.click(screen.getByRole('button', { name: 'Подобається' }))

    expect(onLike).toHaveBeenCalledWith(target)
  })

  it('shows the like count and offers to withdraw an own reaction', () => {
    const onLike = vi.fn()
    const target = message({ body: 'Вітаю', reactions: { likeCount: 3, likedByMe: true } })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own {...handlers} onLike={onLike} />
      </MemoryRouter>,
    )

    const counter = screen.getAllByRole('button', { name: 'Прибрати вподобання' })[0]
    expect(counter).toHaveTextContent('3')
    fireEvent.click(counter)
    expect(onLike).toHaveBeenCalledWith(target)
  })

  it('offers forwarding from the message actions menu', () => {
    const onForward = vi.fn()
    const target = message({ body: 'Вітаю' })
    render(
      <MemoryRouter>
        <MessageBubble threadId="thread-1" message={target} own {...handlers} onForward={onForward} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Переслати' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('article'))
    fireEvent.click(screen.getByRole('button', { name: 'Переслати' }))

    expect(onForward).toHaveBeenCalledWith(target)
  })

  it('grows the edit box so a long message is visible without scrolling', () => {
    const target = message({ body: ['перший', 'другий', 'третій', 'четвертий', 'пʼятий'].join('\n') })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MessageBubble threadId="thread-1" message={target} own {...handlers} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.contextMenu(screen.getByRole('article'))
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))

    expect(screen.getByLabelText('Текст повідомлення')).toHaveAttribute('rows', '6')
  })

  it('renders an image preview plus open and download actions for a clean image', () => {
    const { container } = render(
      <MemoryRouter>
        <OverlayProvider>
          <MessageBubble
            threadId="thread-1"
            message={message({
              attachments: [{
                id: 'file-1',
                fileName: 'photo.png',
                bytes: 1024,
                mimeType: 'image/png',
                scanStatus: 'CLEAN',
              }],
            })}
            own
            {...handlers}
          />
        </OverlayProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/file-1/download?inline=true',
    )
    expect(screen.getByRole('button', { name: 'Зберегти на Диск' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути photo.png' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const preview = screen.getByRole('dialog', { name: 'photo.png' })
    const openInTab = within(preview).getByRole('link', { name: 'Відкрити файл у новій вкладці' })
    expect(openInTab).toHaveAttribute('href', '/api/v1/files/file-1/download?inline=true')
    expect(openInTab).toHaveAttribute('target', '_blank')
    expect(within(preview).getByRole('button', { name: 'Зберегти на Диск' })).toBeVisible()
    expect(within(preview).getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/file-1/download?inline=true',
    )
    fireEvent.click(within(preview).getByRole('button', { name: 'Збільшити' }))
    expect(within(preview).getByRole('button', { name: 'Вмістити зображення у вікно' })).toHaveTextContent('125%')
    expect(screen.getByRole('link', { name: /Завантажити/ })).toHaveAttribute(
      'href',
      '/api/v1/files/file-1/download',
    )
    expect(container.querySelector('.message-bubble__meta .compact-file-name')).toHaveAttribute('title', 'photo.png')
    expect(container.querySelector('.message-attachment__copy > .compact-file-name')).not.toBeInTheDocument()
  })

  it('opens the shared user panel from another author without leaving the thread', () => {
    render(
      <MemoryRouter initialEntries={['/messages/thread-1?unread=true']}>
        <MessageBubble
          threadId="thread-1"
          message={message({ body: 'Вітаю' })}
          own={false}
          {...handlers}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Відкрити профіль Марія' })).toHaveAttribute(
      'href',
      '/messages/thread-1?unread=true&employeeId=user-1',
    )
  })
})
