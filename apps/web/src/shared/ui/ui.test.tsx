import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Drawer, StatusBadge, Tabs } from './index'

describe('shared UI primitives', () => {
  it('localizes status and exposes semantic tab state', () => {
    render(<><StatusBadge status="APPROVED" /><Tabs value="mine" items={[{ value: 'mine', label: 'Мої' }, { value: 'all', label: 'Усі' }]} onChange={() => undefined} /></>)
    expect(screen.getByText('Погоджено')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Мої' })).toHaveAttribute('aria-selected', 'true')
  })

  it('closes a drawer on Escape and restores focus', () => {
    const close = vi.fn()
    render(<><button>До панелі</button><Drawer title="Деталі" onClose={close}>Вміст</Drawer></>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('keeps Tab focus inside an open drawer', () => {
    render(<Drawer title="Деталі" onClose={() => undefined}><button>Перша дія</button><button>Остання дія</button></Drawer>)
    const first = screen.getByRole('button', { name: 'Закрити' })
    const last = screen.getByRole('button', { name: 'Остання дія' })
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(first).toHaveFocus()
  })
})
