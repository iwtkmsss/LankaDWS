import { useState, createRef } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DateTimePicker } from './DateTimePicker'
import { Modal, OverlayProvider } from './Overlay'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  // jsdom hides popovers but does not implement the browser's top layer API.
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value() { this.style.display = 'block' } })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

it('preserves editable native values, refs and form submission after choosing a day', () => {
  const ref = createRef<HTMLInputElement>()
  render(<form aria-label="Форма"><label>Дата<DateTimePicker ref={ref} name="date" type="date" defaultValue="2026-10-13" /></label></form>)
  expect(ref.current).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Відкрити календар' })).toHaveTextContent('13.10.2026')
  fireEvent.change(ref.current!, { target: { value: '2026-10-15' } })
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('date')).toBe('2026-10-15')
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити календар' }))
  expect(screen.getByLabelText('Дата')).toBe(ref.current)
  fireEvent.click(screen.getByRole('gridcell', { name: '19 жовтня 2026 р.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }))
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('date')).toBe('2026-10-19')
  expect(screen.getByRole('button', { name: 'Відкрити календар' })).toHaveTextContent('19.10.2026')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('opens only the custom picker when a required form value is missing', () => {
  render(<form aria-label="Форма"><label>Дата<DateTimePicker name="date" type="date" required /></label></form>)
  act(() => { expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(false) })
  expect(screen.getByRole('dialog', { name: 'Вибір дати' })).toBeVisible()
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

it('updates controlled date and time from wheels with keyboard and midnight wrapping', () => {
  function Example() {
    const [value, setValue] = useState('2026-10-13T23:59')
    return <label>Початок<DateTimePicker type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} /></label>
  }
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити календар' }))
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Години' }), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Хвилини' }), { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }))
  expect(screen.getByLabelText('Початок')).toHaveValue('2026-10-13T00:00')
})

it('emits one normal change event from wheel selection', () => {
  const change = vi.fn()
  render(<DateTimePicker type="time" defaultValue="09:30" onChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Вибрати час' }))
  fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Хвилини' }), { deltaY: 60 })
  fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }))
  expect(change).toHaveBeenCalledTimes(1)
  expect(change.mock.calls[0][0].nativeEvent).toBeInstanceOf(Event)
  expect(change.mock.calls[0][0].target.value).toBe('09:31')
})

it('enforces minimum datetime including time on the boundary day', () => {
  render(<label>Термін<DateTimePicker type="datetime-local" min="2026-10-13T10:30" defaultValue="2026-10-13T11:00" required /></label>)
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити календар' }))
  expect(screen.getByRole('gridcell', { name: '12 жовтня 2026 р.' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Очистити' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Години' }), { key: 'ArrowUp' })
  fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByLabelText('Термін')).toHaveValue('2026-10-13T11:00')
})

it('cancels edits, clears optional fields and does not open disabled inputs', () => {
  render(<><label>Час<DateTimePicker type="time" defaultValue="09:30" /></label><DateTimePicker type="date" disabled /></>)
  fireEvent.click(screen.getByRole('button', { name: 'Вибрати час' }))
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Хвилини' }), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Хвилини' }), { key: 'Escape' })
  expect(screen.getByLabelText('Час')).toHaveValue('09:30')
  fireEvent.click(screen.getByRole('button', { name: 'Вибрати час' }))
  fireEvent.click(screen.getByRole('button', { name: 'Очистити' }))
  expect(screen.getByLabelText('Час')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити календар' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('Escape closes the picker inside a modal without closing the parent', async () => {
  const onClose = vi.fn()
  render(<OverlayProvider><Modal title="Подія" onRequestClose={onClose}><label>Дата<DateTimePicker type="date" defaultValue="2026-10-13" /></label></Modal></OverlayProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити календар' }))
  const picker = screen.getByRole('dialog', { name: 'Вибір дати' })
  fireEvent.keyDown(within(picker).getByRole('button', { name: 'Закрити календар' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Вибір дати' })).not.toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
})
