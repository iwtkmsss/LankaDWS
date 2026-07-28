import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { StrictMode, useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Drawer, OverlayProvider, StatusBadge, Tabs } from './index'

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

function withOverlays(node: ReactNode) {
  return render(<StrictMode><OverlayProvider>{node}</OverlayProvider></StrictMode>)
}

describe('shared UI primitives', () => {
  it('localizes status and exposes semantic tab state', () => {
    render(<><StatusBadge status="APPROVED" /><Tabs value="mine" items={[{ value: 'mine', label: 'Мої' }, { value: 'all', label: 'Усі' }]} onChange={() => undefined} /></>)
    expect(screen.getByText('Погоджено')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Мої' })).toHaveAttribute('aria-selected', 'true')
  })

  it('closes a drawer on Escape and restores focus', () => {
    const close = vi.fn()
    withOverlays(<><button>До панелі</button><Drawer title="Деталі" onClose={close}>Вміст</Drawer></>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby')
  })

  it('keeps Tab focus inside an open drawer', () => {
    withOverlays(<Drawer title="Деталі" onClose={() => undefined}><button>Перша дія</button><button>Остання дія</button></Drawer>)
    const first = screen.getByRole('button', { name: 'Закрити' })
    const last = screen.getByRole('button', { name: 'Остання дія' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
  })

  it('renders through a portal, locks scroll and closes only the top overlay', () => {
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    const view = withOverlays(
      <>
        <Drawer title="Перша" onClose={closeFirst}>Один</Drawer>
        <Drawer title="Друга" onClose={closeSecond}>Два</Drawer>
      </>,
    )
    expect(screen.getByRole('dialog', { name: 'Друга' }).closest('.overlay-app-root')).toBeNull()
    expect(document.body.style.position).toBe('fixed')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeSecond).toHaveBeenCalledOnce()
    expect(closeFirst).not.toHaveBeenCalled()
    view.unmount()
    expect(document.body.style.position).toBe('')
  })

  it('restores focus to the trigger after a drawer unmounts', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Відкрити деталі</button>
          {open && <Drawer title="Деталі" onClose={() => setOpen(false)}>Вміст</Drawer>}
        </>
      )
    }
    withOverlays(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Відкрити деталі' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
