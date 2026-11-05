import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ResizableTextarea } from './ResizableTextarea'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: Number.parseFloat(this.style.height) || 80 } as DOMRect
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('preserves labels, refs, values and form submission while resizing with the keyboard', () => {
  const ref = createRef<HTMLTextAreaElement>()
  render(<form aria-label="Форма"><label htmlFor="comment">Коментар</label><ResizableTextarea id="comment" ref={ref} name="comment" defaultValue="Текст" style={{ minHeight: 50, maxHeight: 120 }} /></form>)
  const grip = screen.getByRole('separator')
  expect(screen.getByLabelText('Коментар')).toBe(ref.current)
  expect(grip).toHaveAttribute('aria-controls', 'comment')
  fireEvent.keyDown(grip, { key: 'ArrowDown', shiftKey: true })
  expect(ref.current).toHaveStyle({ height: '120px' })
  fireEvent.keyDown(grip, { key: 'ArrowDown' })
  expect(ref.current).toHaveStyle({ height: '120px' })
  fireEvent.keyDown(grip, { key: 'ArrowUp', shiftKey: true })
  fireEvent.keyDown(grip, { key: 'ArrowUp', shiftKey: true })
  expect(ref.current).toHaveStyle({ height: '50px' })
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('comment')).toBe('Текст')
})

it('stops dragging after pointer cancellation and clamps the height', () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const ref = createRef<HTMLTextAreaElement>()
  render(<ResizableTextarea ref={ref} style={{ minHeight: 50, maxHeight: 120 }} />)
  const grip = screen.getByRole('separator')
  grip.setPointerCapture = vi.fn()
  fireEvent.pointerDown(grip, { button: 0, clientY: 100 })
  fireEvent.pointerMove(grip, { clientY: 200 })
  expect(ref.current).toHaveStyle({ height: '120px' })
  fireEvent.pointerCancel(grip)
  fireEvent.pointerMove(grip, { clientY: 50 })
  expect(ref.current).toHaveStyle({ height: '120px' })
})

it('keeps hidden and auto-growing fields without a resize control', () => {
  const { rerender } = render(<ResizableTextarea hidden name="transport" value="Текст" readOnly />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(document.querySelector('textarea')).toHaveAttribute('hidden')
  rerender(<ResizableTextarea style={{ resize: 'none' }} />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  rerender(<ResizableTextarea key="disabled" disabled />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
})
