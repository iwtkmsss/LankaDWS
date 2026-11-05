import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePreviewModal, type PreviewFile } from './FilePreviewModal'
import { MAX_TEXT_PREVIEW_BYTES } from './filePreview'
import { OverlayProvider } from '../ui'

function renderPreview() {
  render(
    <OverlayProvider>
      <FilePreviewModal
        file={{ id: 'file-1', fileName: 'photo.png', mimeType: 'image/png', bytes: 2048 }}
        onClose={() => {}}
      />
    </OverlayProvider>,
  )
  const image = screen.getByRole('img', { name: 'photo.png' })
  const stage = screen.getByRole('group', { name: 'Область перегляду зображення' })
  // jsdom reports no layout, so panning bounds need real numbers to clamp against.
  Object.defineProperty(image, 'offsetWidth', { value: 800, configurable: true })
  Object.defineProperty(image, 'offsetHeight', { value: 600, configurable: true })
  Object.defineProperty(stage, 'clientWidth', { value: 400, configurable: true })
  Object.defineProperty(stage, 'clientHeight', { value: 300, configurable: true })
  return { image, stage }
}

describe('FilePreviewModal', () => {
  it('fits the image to the window before any zoom', () => {
    const { image, stage } = renderPreview()

    expect(screen.getByRole('button', { name: 'Вмістити зображення у вікно' })).toHaveTextContent('100%')
    expect(image.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
    expect(stage.className).not.toContain('file-preview-modal__image-stage--pannable')
    expect(screen.getByRole('button', { name: 'Зменшити' })).toBeDisabled()
  })

  it('pans the zoomed image while the pointer drags it', () => {
    const { image, stage } = renderPreview()

    fireEvent.click(screen.getByRole('button', { name: 'Збільшити' }))
    expect(stage.className).toContain('file-preview-modal__image-stage--pannable')

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    expect(stage.className).toContain('file-preview-modal__image-stage--dragging')

    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 70 })
    expect(image.style.transform).toBe('translate3d(40px, -30px, 0) scale(1.25)')

    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(stage.className).not.toContain('file-preview-modal__image-stage--dragging')
  })

  it('recenters the image when the zoom returns to fit', () => {
    const { image, stage } = renderPreview()

    fireEvent.click(screen.getByRole('button', { name: 'Збільшити' }))
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 100 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(image.style.transform).toBe('translate3d(60px, 0px, 0) scale(1.25)')

    fireEvent.click(screen.getByRole('button', { name: 'Вмістити зображення у вікно' }))

    expect(image.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
    expect(stage.className).not.toContain('file-preview-modal__image-stage--pannable')
  })

  it('ignores a drag while the image still fits the window', () => {
    const { image, stage } = renderPreview()

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 180 })

    expect(image.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
    expect(stage.className).not.toContain('file-preview-modal__image-stage--dragging')
  })
})

describe('document previews', () => {
  const fetchFile = vi.fn<typeof fetch>()
  const createObjectURL = vi.fn(() => 'blob:local-pdf')
  const revokeObjectURL = vi.fn()
  const writeText = vi.fn().mockResolvedValue(undefined)
  const file: PreviewFile = { id: 'text-1', fileName: 'notes.txt', mimeType: 'text/plain', bytes: 100 }

  function mount(overrides: Partial<PreviewFile> = {}) {
    return render(<OverlayProvider><FilePreviewModal file={{ ...file, ...overrides }} onClose={() => {}} saveToDrive={false} /></OverlayProvider>)
  }

  beforeEach(() => {
    fetchFile.mockReset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    writeText.mockClear()
    vi.stubGlobal('fetch', fetchFile)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each(['text/plain; charset=utf-8', 'text/csv', 'application/json', 'application/xml'])('safely displays and copies %s', async (mimeType) => {
    const text = 'Привіт\n<script>alert("unsafe")</script> & текст'
    fetchFile.mockResolvedValue(new Response(text))
    mount({ mimeType })
    expect(screen.getByRole('status')).toHaveTextContent('Завантажуємо файл')
    const preview = await screen.findByLabelText('Текст notes.txt')
    expect(preview.textContent).toBe(text)
    expect(preview.querySelector('script')).toBeNull()
    expect(fetchFile).toHaveBeenCalledWith('/api/v1/files/text-1/download', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
    const copy = screen.getByRole('button', { name: 'Копіювати' })
    expect(copy.closest('.overlay__header')).not.toBeNull()
    expect(copy).not.toHaveTextContent('Копіювати')
    expect(screen.queryByText('Текстовий файл')).toBeNull()
    fireEvent.click(copy)
    await screen.findByText('Текст скопійовано')
    expect(writeText).toHaveBeenCalledWith(text)
  })

  it('shows empty text explicitly', async () => {
    fetchFile.mockResolvedValue(new Response(''))
    mount()
    expect(await screen.findByLabelText('Текст notes.txt')).toHaveTextContent('Файл порожній')
    fireEvent.click(screen.getByRole('button', { name: 'Копіювати' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(''))
  })

  it('does not fetch known oversized text', () => {
    mount({ bytes: MAX_TEXT_PREVIEW_BYTES + 1 })
    expect(screen.getByRole('dialog')).toHaveClass('file-preview-modal--compact')
    expect(screen.getByText(/до 1 МБ/)).toBeVisible()
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('accepts text at the limit and counts UTF-8 bytes when size metadata is absent', async () => {
    fetchFile.mockResolvedValueOnce(new Response('x'.repeat(MAX_TEXT_PREVIEW_BYTES)))
    const first = mount({ bytes: MAX_TEXT_PREVIEW_BYTES })
    expect((await screen.findByLabelText('Текст notes.txt')).textContent).toHaveLength(MAX_TEXT_PREVIEW_BYTES)
    first.unmount()
    fetchFile.mockResolvedValueOnce(new Response('я'.repeat(MAX_TEXT_PREVIEW_BYTES / 2 + 1)))
    mount({ bytes: null })
    expect(await screen.findByText('Текстовий файл завеликий для перегляду')).toBeVisible()
    expect(screen.queryByLabelText('Текст notes.txt')).toBeNull()
  })

  it('cancels an oversized response before reading its body', async () => {
    const cancel = vi.fn()
    const response = new Response('too large', { headers: { 'content-length': String(MAX_TEXT_PREVIEW_BYTES + 1) } })
    vi.spyOn(response.body!, 'cancel').mockImplementation(cancel)
    fetchFile.mockResolvedValue(response)
    mount()
    await screen.findByText('Текстовий файл завеликий для перегляду')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('shows an error for denied access and can retry', async () => {
    fetchFile.mockResolvedValueOnce(new Response('private content', { status: 403 }))
      .mockResolvedValueOnce(new Response('Доступ відновлено'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося відкрити файл')
    expect(screen.queryByText('private content')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }))
    expect(await screen.findByLabelText('Текст notes.txt')).toHaveTextContent('Доступ відновлено')
  })

  it('reports clipboard failure without losing the selectable text', async () => {
    fetchFile.mockResolvedValue(new Response('Текст'))
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'))
    mount()
    await screen.findByLabelText('Текст notes.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Копіювати' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Не вдалося скопіювати')
    expect(screen.getByLabelText('Текст notes.txt')).toHaveTextContent('Текст')
  })

  it('aborts reads when closed', () => {
    fetchFile.mockImplementation(() => new Promise(() => {}))
    const view = mount()
    const signal = fetchFile.mock.calls[0][1]!.signal!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('discards a late response after switching files', async () => {
    let resolveOld!: (response: Response) => void
    fetchFile.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(new Response('Новий файл'))
    const view = mount()
    const signal = fetchFile.mock.calls[0][1]!.signal!
    view.rerender(<OverlayProvider><FilePreviewModal file={{ ...file, id: 'text-2', fileName: 'new.txt' }} onClose={() => {}} saveToDrive={false} /></OverlayProvider>)
    expect(await screen.findByLabelText('Текст new.txt')).toHaveTextContent('Новий файл')
    expect(signal.aborted).toBe(true)
    resolveOld(new Response('Старий файл'))
    await waitFor(() => expect(screen.getByLabelText('Текст new.txt')).not.toHaveTextContent('Старий файл'))
  })

  it('fetches PDFs with authorization and revokes their local URL on close', async () => {
    fetchFile.mockResolvedValue(new Response('%PDF-1.4\n'))
    const view = mount({ id: 'pdf-1', fileName: 'report.pdf', mimeType: 'application/pdf' })
    expect(await screen.findByTitle('Перегляд report.pdf')).toHaveAttribute('src', 'blob:local-pdf')
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }))
    const open = screen.getByRole('link', { name: 'Відкрити файл у новій вкладці' })
    expect(open).toHaveAttribute('href', '/api/v1/files/pdf-1/download?inline=true')
    expect(open.closest('.overlay__header')).not.toBeNull()
    expect(open.textContent).toBe('')
    expect(screen.queryByText('Відкрити окремо')).toBeNull()
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-pdf')
  })

  it.each([
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['table.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['archive.zip', 'application/zip'],
    ['unknown', null],
  ])('uses a compact download card for %s', (fileName, mimeType) => {
    mount({ fileName: fileName!, mimeType })
    expect(screen.getByRole('dialog')).toHaveClass('file-preview-modal--compact')
    expect(screen.getByText(/Завантажте файл/)).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Завантажити' })).toHaveAttribute('href', '/api/v1/files/text-1/download')
    expect(fetchFile).not.toHaveBeenCalled()
  })
})
