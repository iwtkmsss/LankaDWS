import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChatAttachmentView } from '@lankadws/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageComposer } from './MessageComposer'
import { api } from '../../../shared/api/client'

vi.mock('../../../shared/api/client', () => ({ api: vi.fn() }))

function renderComposer(
  onSend = vi.fn(async () => true),
  attachments: ChatAttachmentView[] = [],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onFiles = vi.fn()
  const onRemoveAttachment = vi.fn()
  const rendered = render(
    <QueryClientProvider client={client}>
      <MessageComposer
        currentUserId="me"
        threadId="thread-1"
        replyTo={null}
        attachments={attachments}
        sending={false}
        uploading={false}
        onReplyCancel={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
        onFiles={onFiles}
        onSend={onSend}
      />
    </QueryClientProvider>,
  )
  return {
    input: screen.getByRole('textbox', { name: 'Повідомлення' }),
    onSend,
    onFiles,
    onRemoveAttachment,
    unmount: rendered.unmount,
  }
}

describe('MessageComposer', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('deletes a draft attachment on the server and blocks sending until deletion finishes', async () => {
    let finish: (() => void) | undefined
    vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ discarded: true }) }))
    const { onSend, onRemoveAttachment, input } = renderComposer(vi.fn(async () => true), [{
      id: 'draft-file', fileName: 'report.txt', bytes: 8, mimeType: 'text/plain', scanStatus: 'CLEAN',
    }])
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати report.txt' }))
    expect(api).toHaveBeenCalledWith('/files/draft-file/draft', { method: 'DELETE' })
    expect(onRemoveAttachment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    finish?.()
    await waitFor(() => expect(onRemoveAttachment).toHaveBeenCalledWith('draft-file'))
  })

  it('keeps an attachment selected when server deletion fails', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    const { onRemoveAttachment } = renderComposer(undefined, [{
      id: 'draft-file', fileName: 'report.txt', bytes: 8, mimeType: 'text/plain', scanStatus: 'CLEAN',
    }])
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати report.txt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося прибрати файл')
    expect(onRemoveAttachment).not.toHaveBeenCalled()
  })

  it('focuses the message field when the conversation opens', async () => {
    const { input } = renderComposer()
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('does not submit the same draft twice while sending is in progress', async () => {
    let finish: ((sent: boolean) => void) | undefined
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const { input } = renderComposer(onSend)
    fireEvent.change(input, { target: { value: 'Одне повідомлення' } })

    const sendButton = screen.getByRole('button', { name: 'Надіслати' })
    fireEvent.click(sendButton)
    fireEvent.click(sendButton)

    expect(onSend).toHaveBeenCalledTimes(1)
    finish?.(true)
    await waitFor(() => expect(input).toHaveValue(''))
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('sends with Enter and clears the draft after success', async () => {
    const { input, onSend } = renderComposer()
    fireEvent.change(input, { target: { value: '  Вітаю  ' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ body: 'Вітаю', mentions: [] }))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('keeps Shift+Enter and IME composition from submitting', () => {
    const { input, onSend } = renderComposer()
    fireEvent.change(input, { target: { value: 'Чернетка' } })

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false, isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('Чернетка')
  })

  it('preserves a failed draft so retry submits the same content', async () => {
    const onSend = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const { input } = renderComposer(onSend)
    fireEvent.change(input, { target: { value: 'Повторити' } })

    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(input).toHaveValue('Повторити')

    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend.mock.calls[0]).toEqual(onSend.mock.calls[1])
  })

  it('sends an attachment without requiring text', async () => {
    const onSend = vi.fn(async () => true)
    const attachment: ChatAttachmentView = {
      id: 'file-one',
      fileName: 'звіт.pdf',
      bytes: 1_024,
      mimeType: 'application/pdf',
      scanStatus: 'CLEAN',
    }
    renderComposer(onSend, [attachment])

    const sendButton = screen.getByRole('button', { name: 'Надіслати' })
    expect(sendButton).toBeEnabled()
    fireEvent.click(sendButton)

    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ body: '', mentions: [] }))
  })

  it('adds files from the clipboard through the attachment uploader', () => {
    const { input, onFiles } = renderComposer()
    const image = new File(['image'], 'скріншот.png', { type: 'image/png' })

    fireEvent.paste(input, { clipboardData: { files: [image] } })

    expect(onFiles).toHaveBeenCalledWith([image])
  })

  it('restores an unsent draft after the composer remounts', () => {
    const first = renderComposer()
    fireEvent.change(first.input, { target: { value: 'Не втрачати цей текст' } })
    first.unmount()

    const second = renderComposer()
    expect(second.input).toHaveValue('Не втрачати цей текст')
  })

  it('preserves a draft written before the shared draft store was introduced', () => {
    window.sessionStorage.setItem('lankadws:message-draft:thread-1', 'Попередня чернетка')
    const { input } = renderComposer()
    expect(input).toHaveValue('Попередня чернетка')
    expect(window.sessionStorage.getItem('lankadws:message-draft:thread-1')).toBeNull()
  })

  it('sends raw @text without a mention and stores a mention only after candidate selection', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] })
    const rawSend = vi.fn(async () => true)
    const { input: rawInput, unmount } = renderComposer(rawSend)
    fireEvent.change(rawInput, { target: { value: '@оле', selectionStart: 4 } })
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
    await waitFor(() => expect(rawSend).toHaveBeenCalledWith({ body: '@оле', mentions: [] }))
    unmount()

    vi.mocked(api).mockResolvedValue({
      items: [{
        id: 'usr_olena',
        displayName: 'Олена Бондар',
        username: 'olena',
        jobTitle: 'HR-фахівчиня',
        avatarAsset: null,
      }],
    })
    const selectedSend = vi.fn(async () => true)
    const { input } = renderComposer(selectedSend)
    fireEvent.change(input, { target: { value: '@оле', selectionStart: 4 } })
    fireEvent.click(await screen.findByRole('option', { name: /Олена Бондар/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Надіслати' }).at(-1)!)
    await waitFor(() => expect(selectedSend).toHaveBeenCalledWith({
      body: '@Олена Бондар',
      mentions: [{ userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' }],
    }))
  })
})
