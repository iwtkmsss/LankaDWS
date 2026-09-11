import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FilePreviewModal } from './FilePreviewModal'
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
