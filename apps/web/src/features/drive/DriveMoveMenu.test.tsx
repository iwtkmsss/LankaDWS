import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { DriveMoveMenu, placeMoveMenu } from './DriveMoveMenu'
import type { DriveTarget } from './DriveItems'

vi.mock('../../shared/api/client', async (load) => ({ ...await load<object>(), api: vi.fn() }))
const folder = { id: 'root', name: 'Договори', hasChildren: true }
const child = { id: 'child', name: '2026', hasChildren: false }
const target: DriveTarget = { kind: 'FOLDER', folder: {
  id: 'source', name: 'Source', parentId: null, companyId: 'company', ownerId: 'me', ownerName: 'Me',
  isOwner: true, accessRole: 'EDITOR', isShared: false, sharedWithCount: 0, childCount: 1, sizeBytes: 0, updatedAt: '', trashedAt: null,
} }
function mount(onMove = vi.fn().mockResolvedValue(undefined), onDone = vi.fn(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={client}>
    <DriveMoveMenu target={target} menuId="move-test" onMove={onMove} onDone={onDone} />
  </QueryClientProvider>)
  return { onMove, onDone }
}
beforeEach(() => {
  vi.mocked(api).mockImplementation((path) => {
    const folderId = new URLSearchParams(path.split('?')[1]).get('folderId')
    return Promise.resolve({ items: folderId === 'root' ? [child] : folderId === 'child' ? [] : [folder], nextCursor: null })
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Drive move list', () => {
  it('refreshes cached empty root and nested destinations without visiting them on the Drive page', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    for (const folderId of [undefined, 'root']) client.setQueryData(['drive', 'move-destination', 'FOLDER', 'source', folderId], {
      pages: [{ items: [], nextCursor: null }], pageParams: [undefined],
    })
    mount(vi.fn().mockResolvedValue(undefined), vi.fn(), client)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Перемістити' }), { key: 'ArrowRight' })
    const destination = await screen.findByRole('menuitem', { name: 'Договори' })
    await waitFor(() => expect(destination).toHaveFocus())
    fireEvent.click(destination)
    expect(await screen.findByRole('menuitem', { name: '2026' })).toBeVisible()
    expect(vi.mocked(api).mock.calls.every(([path]) => path.startsWith('/drive/destinations?'))).toBe(true)
  })
  it('replaces the same panel when entering folders and confirms inside that menu', async () => {
    const { onMove, onDone } = mount()
    expect(api).not.toHaveBeenCalled()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    const menu = await screen.findByRole('menu', { name: 'Папки призначення' })
    expect(screen.queryByText('Мій диск')).not.toBeInTheDocument()
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Договори' }))
    const branch = await screen.findByRole('menu', { name: 'Перемістити в Договори' })
    expect(branch).toBe(menu)
    fireEvent.click(await within(branch).findByRole('menuitem', { name: '2026' }))
    const nested = await screen.findByRole('menu', { name: 'Перемістити в 2026' })
    expect(nested).toBe(menu)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.queryByText('Немає вкладених папок')).not.toBeInTheDocument()
    const confirm = within(nested).getByRole('menuitem', { name: 'Перемістити сюди' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('child'))
    expect(onDone).toHaveBeenCalledOnce()
  })
  it('supports keyboard navigation and a visible Back button on every nested level', async () => {
    mount()
    const trigger = screen.getByRole('menuitem', { name: 'Перемістити' })
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    const root = await screen.findByRole('menu', { name: 'Папки призначення' })
    fireEvent.keyDown(await within(root).findByRole('menuitem', { name: 'Договори' }), { key: 'ArrowRight' })
    await screen.findByRole('menu', { name: 'Перемістити в Договори' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Назад до папок' }))
    expect(await screen.findByRole('menu', { name: 'Папки призначення' })).toBeVisible()
    fireEvent.keyDown(root, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('loads the next server page when scrolling near the end', async () => {
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('cursor=next')
      ? { items: [child], nextCursor: null } : { items: [folder], nextCursor: 'next' }))
    mount()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    await screen.findByRole('menuitem', { name: 'Договори' })
    const list = screen.getByRole('group', { name: 'Папки для перенесення' })
    Object.defineProperties(list, { scrollHeight: { value: 400 }, clientHeight: { value: 238 }, scrollTop: { value: 200, writable: true } })
    fireEvent.scroll(list)
    expect(await screen.findByRole('menuitem', { name: '2026' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Договори' })).toBeVisible()
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('cursor=next'))).toBe(true)
  })
  it('explains when there are no available destinations without offering an invalid action', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], nextCursor: null })
    mount()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    await screen.findByRole('menu')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText('Немає доступних папок для перенесення')).toBeVisible()
    expect(screen.queryByText('Мій диск')).not.toBeInTheDocument()
    expect(screen.queryByText('Немає вкладених папок')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Перемістити сюди' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'У корінь диска' })).not.toBeInTheDocument()
  })
  it('keeps the selected directory and allows retry after a failed move', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('permission denied'))
    const { onDone } = mount(onMove)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Перемістити' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Договори' }))
    const confirm = screen.getByRole('menuitem', { name: 'Перемістити сюди' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося перемістити')
    expect(onDone).not.toHaveBeenCalled()
    expect(confirm).toBeEnabled()
  })
})

describe('Move menu placement', () => {
  it('opens right and down when there is room', () => {
    expect(placeMoveMenu({ left: 100, right: 140, top: 100, bottom: 134 }, 240, 180, 800, 600)).toEqual({ left: 144, top: 100 })
  })
  it('opens left and up near the bottom-right edge', () => {
    expect(placeMoveMenu({ left: 700, right: 740, top: 500, bottom: 534 }, 240, 180, 800, 600)).toEqual({ left: 456, top: 354 })
  })
  it('keeps a narrow-screen panel inside the viewport', () => {
    expect(placeMoveMenu({ left: 60, right: 260, top: 100, bottom: 134 }, 304, 184, 320, 200)).toEqual({ left: 8, top: 8 })
  })
})
