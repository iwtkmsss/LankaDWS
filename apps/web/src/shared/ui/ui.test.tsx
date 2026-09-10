import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { StrictMode, useState } from 'react'
import {
  createMemoryRouter,
  RouterProvider,
  useNavigate,
} from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  CompactFileName,
  ConfirmationDialog,
  Drawer,
  Modal,
  OverlayProvider,
  StatusBadge,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from './index'

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
})

function withOverlays(node: ReactNode) {
  return render(<StrictMode><OverlayProvider>{node}</OverlayProvider></StrictMode>)
}

describe('shared UI primitives', () => {
  it('uses a neutral silhouette when a user has no avatar', () => {
    const { container, rerender } = render(<Avatar name="Марія Іваненко" />)
    expect(container.querySelector('.avatar--placeholder svg')).toBeInTheDocument()
    expect(container.querySelector('.avatar')).not.toHaveTextContent('МІ')

    rerender(<Avatar name="Марія Іваненко" src="/avatar.jpg" />)
    expect(container.querySelector('.avatar--placeholder')).not.toBeInTheDocument()
    expect(container.querySelector('.avatar img')).toHaveAttribute('src', '/avatar.jpg')

    rerender(<Avatar name="Марія Іваненко" src="file_avatar123" />)
    expect(container.querySelector('.avatar img')).toHaveAttribute('src', '/api/v1/me/avatar/file_avatar123')

    fireEvent.error(container.querySelector('.avatar img')!)
    expect(container.querySelector('.avatar--placeholder svg')).toBeInTheDocument()
  })

  it('localizes status and exposes semantic tab state', () => {
    render(<><StatusBadge status="APPROVED" /><Tabs value="mine" items={[{ value: 'mine', label: 'Мої' }, { value: 'all', label: 'Усі' }]} onChange={() => undefined} /></>)
    expect(screen.getByText('Погоджено')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Мої' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps a file extension separate from the truncated name', () => {
    const { container } = render(<CompactFileName fileName="Screenshot of a very long dashboard name.png" />)
    expect(container.querySelector('.compact-file-name__stem')).toHaveTextContent('Screenshot of a very long dashboard name')
    expect(container.querySelector('.compact-file-name__extension')).toHaveTextContent('.png')
    expect(container.querySelector('.compact-file-name')).toHaveAttribute('title', 'Screenshot of a very long dashboard name.png')
  })

  it('reports Escape and close-button reasons and exposes dialog semantics', () => {
    const close = vi.fn()
    const view = withOverlays(
      <Drawer title="Деталі" onRequestClose={close}>Вміст</Drawer>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenLastCalledWith('escape')
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')

    view.rerender(
      <StrictMode>
        <OverlayProvider>
          <Drawer title="Деталі" onRequestClose={close}>Вміст</Drawer>
        </OverlayProvider>
      </StrictMode>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }))
    expect(close).toHaveBeenLastCalledWith('close-button')
  })

  it('reports backdrop clicks only from the top backdrop', () => {
    const close = vi.fn()
    withOverlays(<Modal title="Форма" onRequestClose={close}>Вміст</Modal>)
    fireEvent.mouseDown(document.querySelector('.overlay-layer')!)
    expect(close).toHaveBeenCalledWith('backdrop')
  })

  it('keeps Tab focus inside an open drawer', () => {
    withOverlays(
      <Drawer title="Деталі" onRequestClose={() => undefined}>
        <button>Перша дія</button>
        <button>Остання дія</button>
      </Drawer>,
    )
    const first = screen.getByRole('button', { name: 'Закрити' })
    const last = screen.getByRole('button', { name: 'Остання дія' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
  })

  it('renders through a portal, locks scroll and activates only the top overlay', () => {
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    const view = withOverlays(
      <>
        <Drawer title="Перша" onRequestClose={closeFirst}>Один</Drawer>
        <Drawer title="Друга" onRequestClose={closeSecond}>Два</Drawer>
      </>,
    )
    const first = document.querySelectorAll<HTMLElement>('[role="dialog"]')[0]
    const second = screen.getByRole('dialog', { name: 'Друга' })
    expect(first).toHaveTextContent('Перша')
    expect(second.closest('.overlay-app-root')).toBeNull()
    expect(first).toHaveAttribute('aria-hidden', 'true')
    expect(first).toHaveAttribute('inert')
    expect(document.body.style.position).toBe('fixed')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeSecond).toHaveBeenCalledWith('escape')
    expect(closeFirst).not.toHaveBeenCalled()
    view.unmount()
    expect(document.body.style.position).toBe('')
  })

  it('uses the fixed header/body/footer grid contract and size classes', () => {
    withOverlays(
      <Modal
        title="Велика форма"
        size="xl"
        footer={<button>Зберегти</button>}
        onRequestClose={() => undefined}
      >
        Довгий вміст
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('overlay-surface--size-xl')
    expect(dialog).toHaveClass('overlay-surface--mobile-fullscreen')
    expect(dialog.querySelector(':scope > .overlay__header')).toBeInTheDocument()
    expect(dialog.querySelector(':scope > .overlay__body')).toHaveTextContent('Довгий вміст')
    expect(dialog.querySelector(':scope > .overlay__footer')).toHaveTextContent('Зберегти')
  })

  it('uses alertdialog and initially focuses the safe confirmation action', () => {
    const cancel = vi.fn()
    withOverlays(
      <ConfirmationDialog
        title="Видалити запис?"
        onRequestClose={cancel}
        onConfirm={() => undefined}
      >
        Дію не можна скасувати.
      </ConfirmationDialog>,
    )
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Видалити запис?')
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus()
  })

  it('checks dirty state before starting the close animation', () => {
    function GuardedDrawer() {
      const [open, setOpen] = useState(true)
      const guard = useModalCloseGuard({
        dirty: true,
        onRequestClose: () => setOpen(false),
      })
      return (
        <OverlayProvider>
          {open && (
            <Drawer
              title="Форма"
              onBeforeClose={guard.shouldClose}
              onRequestClose={guard.requestClose}
            >
              <input aria-label="Назва" defaultValue="Зміна" />
            </Drawer>
          )}
          <UnsavedChangesDialog guard={guard} />
        </OverlayProvider>
      )
    }
    const router = createMemoryRouter([{ path: '/', element: <GuardedDrawer /> }])
    render(<RouterProvider router={router} />)
    const formLayer = screen.getByRole('dialog', { name: 'Форма' }).closest('.overlay-layer')
    const matchMedia = vi.mocked(window.matchMedia)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    matchMedia.mockReturnValue({ ...reducedMotion, matches: false })

    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }))
    matchMedia.mockReturnValue(reducedMotion)

    const confirmation = screen.getByRole('alertdialog', { name: 'Закрити без збереження?' })
    expect(formLayer).not.toHaveClass('is-closing')
    expect(confirmation).toHaveClass('unsaved-changes-dialog')
    expect(screen.getByRole('button', { name: 'Продовжити редагування' })).toHaveClass('button--primary')
    expect(screen.getByRole('button', { name: 'Закрити без збереження' })).toHaveClass('button--danger')
  })

  it('routes dirty form navigation through the shared close guard', async () => {
    function GuardedForm() {
      const navigate = useNavigate()
      const [open, setOpen] = useState(true)
      const guard = useModalCloseGuard({
        dirty: true,
        onRequestClose: () => setOpen(false),
      })
      return (
        <OverlayProvider>
          {open && (
            <Drawer
              title="Форма"
              onBeforeClose={guard.shouldClose}
              onRequestClose={guard.requestClose}
            >
              <input aria-label="Назва" defaultValue="Зміна" />
              <button onClick={() => navigate('/next')}>До іншої сторінки</button>
            </Drawer>
          )}
          <UnsavedChangesDialog guard={guard} />
        </OverlayProvider>
      )
    }
    const router = createMemoryRouter([
      { path: '/', element: <GuardedForm /> },
      { path: '/next', element: <p>Інша сторінка</p> },
    ])
    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('button', { name: 'До іншої сторінки' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Продовжити редагування' }))
    expect(screen.getByRole('dialog', { name: 'Форма' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'До іншої сторінки' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Закрити без збереження' }))
    expect(await screen.findByText('Інша сторінка')).toBeInTheDocument()
  })

  it('restores focus to the trigger after a drawer unmounts', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Відкрити деталі</button>
          {open && (
            <Drawer title="Деталі" onRequestClose={() => setOpen(false)}>
              Вміст
            </Drawer>
          )}
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
