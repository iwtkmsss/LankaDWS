import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageComposer } from './MessageComposer'

function renderComposer(onSend = vi.fn(async () => true)) {
  render(
    <MessageComposer
      replyTo={null}
      attachments={[]}
      sending={false}
      uploading={false}
      error=""
      onReplyCancel={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onFiles={vi.fn()}
      onSend={onSend}
    />,
  )
  return {
    input: screen.getByRole('textbox', { name: 'Повідомлення' }),
    onSend,
  }
}

describe('MessageComposer', () => {
  it('sends with Enter and clears the draft after success', async () => {
    const { input, onSend } = renderComposer()
    fireEvent.change(input, { target: { value: '  Вітаю  ' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Вітаю'))
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
})
