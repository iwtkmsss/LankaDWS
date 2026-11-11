import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { clampToViewport, Menu, MenuItem, Tabs, useDetailsMenu } from './index'

function Harness() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={trigger} onClick={() => setOpen((value) => !value)}>Дії</button>
      <p>outside</p>
      <Menu open={open} label="Меню" triggerRef={trigger} onClose={() => setOpen(false)}>
        <MenuItem>Перший</MenuItem>
        <MenuItem disabled>Вимкнений</MenuItem>
        <MenuItem>Другий</MenuItem>
        <MenuItem>Третій</MenuItem>
      </Menu>
    </div>
  )
}

describe('Menu', () => {
  it('focuses the first item on open and navigates with arrows, Home and End', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }))
    const menu = screen.getByRole('menu', { name: 'Меню' })
    const first = screen.getByRole('menuitem', { name: 'Перший' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Другий' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Третій' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Третій' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(first).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Дії' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Перший' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on outside pointer but not on the trigger or inside the menu', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Дії' }))
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Другий' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Tab', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('places a point menu inside the viewport', () => {
    expect(clampToViewport(1000, 900, 200, 300, 800, 600)).toEqual({ left: 592, top: 292 })
    expect(clampToViewport(-5, -5, 200, 300, 800, 600)).toEqual({ left: 8, top: 8 })
    render(<Menu open point={{ x: 10, y: 20 }} label="Контекст" onClose={vi.fn()}><MenuItem>Один</MenuItem></Menu>)
    expect(screen.getByRole('menu', { name: 'Контекст' })).toHaveStyle({ position: 'fixed' })
  })
})

function DetailsHarness() {
  const { detailsProps } = useDetailsMenu()
  return (
    <details {...detailsProps}>
      <summary aria-label="Відкрити">⋯</summary>
      <div role="menu"><MenuItem>А</MenuItem><MenuItem>Б</MenuItem></div>
    </details>
  )
}

describe('useDetailsMenu', () => {
  it('focuses the first item, supports arrows and Escape back to the summary', () => {
    render(<DetailsHarness />)
    const summary = screen.getByLabelText('Відкрити')
    const details = summary.closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByRole('menuitem', { name: 'А' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'А' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Б' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Б' }), { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
  })

  it('closes on outside pointer', () => {
    render(<><DetailsHarness /><p>outside</p></>)
    const details = screen.getByLabelText('Відкрити').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(details.open).toBe(false)
  })
})

describe('Tabs keyboard', () => {
  function TabsHarness() {
    const [value, setValue] = useState('a')
    return <Tabs value={value} onChange={setValue} items={[{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }, { value: 'c', label: 'В' }]} />
  }
  it('uses roving tabindex and arrow/Home/End navigation', () => {
    render(<TabsHarness />)
    const [a, b, c] = screen.getAllByRole('tab')
    expect(a).toHaveAttribute('tabindex', '0')
    expect(b).toHaveAttribute('tabindex', '-1')
    a!.focus()
    fireEvent.keyDown(a!, { key: 'ArrowRight' })
    expect(b).toHaveFocus()
    expect(b).toHaveAttribute('aria-selected', 'true')
    expect(a).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(b!, { key: 'End' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c!, { key: 'ArrowRight' })
    expect(a).toHaveFocus()
    fireEvent.keyDown(a!, { key: 'ArrowLeft' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c!, { key: 'Home' })
    expect(a).toHaveFocus()
    expect(a).toHaveAttribute('aria-selected', 'true')
  })
})
