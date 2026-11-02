import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShowcaseCommentComposer } from './ShowcaseCommentComposer'
import { useShowcasePhotos } from './showcasePhotos'
import { OverlayProvider } from '../../shared/ui'

const createUrl = vi.fn(), revokeUrl = vi.fn()
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  let counter = 0
  createUrl.mockImplementation(() => `blob:photo-${++counter}`)
  revokeUrl.mockReset()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl })
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 1200; naturalHeight = 800; decode() { return Promise.resolve() } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('uses plain text and permits a photo-only comment with removable previews', async () => {
  const send = vi.fn()
  function Composer() {
    const [value, setValue] = useState('')
    const photos = useShowcasePhotos()
    return <ShowcaseCommentComposer id="comment" value={value} onChange={setValue} photos={photos} sending={false} onCancelReply={() => {}} onSend={send} />
  }
  const { container } = render(<OverlayProvider><Composer /></OverlayProvider>)
  expect(container.querySelector('textarea')).toBeInTheDocument()
  expect(container.querySelector('.formatting-toolbar')).toBeNull()
  expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Фото до коментаря'), { target: { files: [new File(['png'], 'screen.png', { type: 'image/png' })] } })
  await screen.findByAltText('screen.png')
  fireEvent.click(screen.getByRole('button', { name: 'Переглянути screen.png' }))
  expect(await screen.findByRole('dialog', { name: 'screen.png' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: 'Надіслати' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }))
  expect(send).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Прибрати screen.png' }))
  expect(screen.queryByAltText('screen.png')).toBeNull()
  expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled()
})

it('accepts screenshots from the clipboard and blocks unsupported images', async () => {
  function Composer() {
    const photos = useShowcasePhotos()
    return <ShowcaseCommentComposer id="comment" value="" onChange={() => {}} photos={photos} sending={false} onCancelReply={() => {}} onSend={() => {}} />
  }
  render(<Composer />)
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new File(['png'], 'clipboard.png', { type: 'image/png' })] } })
  await screen.findByAltText('clipboard.png')
  fireEvent.change(screen.getByLabelText('Фото до коментаря'), { target: { files: [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })] } })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PNG'))
  expect(screen.queryByAltText('unsafe.svg')).toBeNull()
})

it('limits photos to five, keeps sent photo URLs alive and releases them when leaving the example', async () => {
  const { result, unmount } = renderHook(useShowcasePhotos)
  await act(async () => { await result.current.add(Array.from({ length: 6 }, (_, index) => new File(['png'], `${index}.png`, { type: 'image/png' }))) })
  expect(result.current.photos).toHaveLength(5)
  expect(result.current.error).toContain('5 фото')
  act(() => result.current.clearDraft())
  expect(result.current.photos).toHaveLength(0)
  expect(revokeUrl).not.toHaveBeenCalled()
  unmount()
  expect(revokeUrl).toHaveBeenCalledTimes(5)
})

it('adds photos without crypto.randomUUID, as on a local HTTP address', async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto)
  vi.stubGlobal('crypto', { getRandomValues })
  const { result } = renderHook(useShowcasePhotos)
  await act(async () => { await result.current.add([new File(['png'], 'screen.png', { type: 'image/png' })]) })
  expect(result.current.error).toBe('')
  expect(result.current.photos).toHaveLength(1)
  expect(result.current.photos[0]?.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  expect(result.current.busy).toBe(false)
})

it('still rejects unreadable images and releases their object URLs', async () => {
  vi.stubGlobal('Image', class { src = ''; decode() { return Promise.reject(new Error('Invalid image')) } })
  const { result } = renderHook(useShowcasePhotos)
  await act(async () => { await result.current.add([new File(['invalid'], 'broken.png', { type: 'image/png' })]) })
  expect(result.current.photos).toHaveLength(0)
  expect(result.current.error).toContain('Не вдалося відкрити фото')
  expect(result.current.busy).toBe(false)
  expect(revokeUrl).toHaveBeenCalledWith('blob:photo-1')
})
