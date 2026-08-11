import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { MessageComposer } from './MessageComposer'
import { api } from '../../../shared/api/client'

vi.mock('../../../shared/api/client', () => ({ api: vi.fn() }))

function renderComposer(onSend = vi.fn(async () => true)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={client}>
      <MessageComposer
        threadId="thread-1"
        replyTo={null}
        attachments={[]}
        sending={false}
        uploading={false}
        error=""
        onReplyCancel={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onFiles={vi.fn()}
        onSend={onSend}
      />
    </QueryClientProvider>,
  )
  return {
    input: screen.getByRole('combobox', { name: 'Повідомлення' }),
    onSend,
    unmount: rendered.unmount,
  }
}

describe('MessageComposer', () => {
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
