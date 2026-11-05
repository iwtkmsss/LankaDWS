import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrganizationMap } from './OrganizationMap'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())

it('closes on a nearby outside pointerdown, preserves panel input, and respects dialogs', () => {
  const onClose = vi.fn()
  render(<><OrganizationMap company={{ id: 'company', name: 'Компанія', description: null, manager: null, version: 1 }} units={[]} selectedId={null} onSelect={vi.fn()} onBackgroundClick={onClose} sidePanel={<label>Опис<textarea /></label>} /><button>Поруч</button><div role="dialog"><button>У діалозі</button></div></>)
  fireEvent.pointerDown(screen.getByLabelText('Опис'), { button: 0 })
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'У діалозі' }), { button: 0 })
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Поруч' }), { button: 0 })
  expect(onClose).toHaveBeenCalledOnce()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(2)
})
