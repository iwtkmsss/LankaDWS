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
  const rendered = render(
    <QueryClientProvider client={client}>
      <MessageComposer
        threadId="thread-1"
        replyTo={null}
        attachments={attachments}
        sending={false}
        uploading={false}
        error=""
        onReplyCancel={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onFiles={onFiles}
        onSend={onSend}
      />
    </QueryClientProvider>,
  )
  return {
    input: screen.getByRole('textbox', { name: 'Повідомлення' }),
    onSend,
    onFiles,
    unmount: rendered.unmount,
  }
}

describe('MessageComposer', () => {
  beforeEach(() => window.sessionStorage.clear())

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
