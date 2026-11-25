import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { NOTICE_EVENT, type NoticeDetail } from '../../shared/ui/notify'
import { OverlayProvider } from '../../shared/ui/Overlay'
import { TopbarContent, TopbarContentProvider } from '../../layout/TopbarContent'
import DrivePage from './DrivePage'

// «Скасувати» on Drive success notices reverts the action (decision 2026-11-18).

const auth = vi.hoisted(() => ({ accountType: 'USER' }))
vi.mock('../../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'usr_me', accountType: auth.accountType, company: { id: 'cmp_one' } } }),
}))
vi.mock('../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: vi.fn(),
}))

const folder = {
  id: 'fol_contracts', name: 'Договори', parentId: null, companyId: 'cmp_one',
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 0, childCount: 1,
  sizeBytes: 2048, updatedAt: '2026-09-04T10:00:00.000Z', trashedAt: null,
}
const file = {
  id: 'doc_one', number: 'DOC-1', name: 'Звіт', companyId: 'cmp_one', folderId: null,
  fileId: 'file_image', mimeType: 'image/png', extension: '.png', fileType: 'IMAGE' as const, sizeBytes: 2048,
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 0,
  version: 3, updatedAt: '2026-09-03T10:00:00.000Z', trashedAt: null,
}
const counts = { MY_DRIVE: 2, SHARED: 0, RECENT: 1, TRASH: 0 }
let notices: NoticeDetail[] = []
let driveUrls: string[] = []
const capture = (event: Event) => { notices.push((event as CustomEvent<NoticeDetail>).detail) }

function mount(initialEntry = '/drive') {
  const router = createMemoryRouter(
    [{ path: '/drive', element: <OverlayProvider><TopbarContentProvider><TopbarContent /><DrivePage /></TopbarContentProvider></OverlayProvider> }],
    { initialEntries: [initialEntry] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  auth.accountType = 'USER'
  notices = []
  driveUrls = []
  window.addEventListener(NOTICE_EVENT, capture)
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/drive/destinations?')) {
      const destination = new URLSearchParams(path.split('?')[1]).get('folderId')
      return { items: destination ? [] : [{ id: folder.id, name: folder.name, hasChildren: false }], nextCursor: null }
    }
    if (path.startsWith('/drive?') || path === '/drive') {
      driveUrls.push(path)
      return { breadcrumbs: [], folders: [folder], files: [file], counts, owner: { id: 'usr_other', displayName: 'Іван', username: 'ivan' } }
    }
    if (path === '/documents/doc_one/archive') return { archived: true, archivedAt: '2026-11-18T10:00:00.000Z', version: 4 }
    if (path === '/documents/doc_one/restore') return { restored: true, version: 5 }
    if (path === '/drive/documents/doc_one/move') return { moved: true, version: 4 }
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => {
  window.removeEventListener(NOTICE_EVENT, capture)
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Drive undo', () => {
  it('restores a trashed file with the version returned by the trash request', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Переглянути: Звіт' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити' }))
    await waitFor(() => expect(notices.at(-1)?.message).toBe('Переміщено в кошик'))
    const refreshesBefore = driveUrls.length
    await notices.at(-1)!.undo!()
    expect(api).toHaveBeenCalledWith('/documents/doc_one/restore', { method: 'POST', body: JSON.stringify({ expectedVersion: 4 }) })
    await waitFor(() => expect(driveUrls.length).toBeGreaterThan(refreshesBefore))
  })

  it('moves a file back to its previous folder', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Звіт' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    const destinations = await screen.findByRole('menu', { name: 'Папки призначення' })
    fireEvent.click(await within(destinations).findByRole('menuitem', { name: 'Договори' }))
    const confirm = within(await screen.findByRole('menu', { name: 'Перемістити в Договори' })).getByRole('menuitem', { name: 'Перемістити сюди' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(notices.at(-1)?.message).toBe('Переміщено'))
    await notices.at(-1)!.undo!()
    expect(api).toHaveBeenCalledWith('/drive/documents/doc_one/move', { method: 'POST', body: JSON.stringify({ folderId: null, expectedVersion: 4 }) })
  })

  it('lets an administrator open one user\'s trash', async () => {
    auth.accountType = 'ADMIN'
    mount('/drive?view=USERS&owner=usr_other')
    fireEvent.click(await screen.findByRole('button', { name: 'Кошик користувача' }))
    await waitFor(() => expect(driveUrls.at(-1)).toContain('view=TRASH'))
    expect(driveUrls.at(-1)).toContain('ownerId=usr_other')
    expect(screen.getByRole('button', { name: 'Кошик користувача' })).toHaveAttribute('aria-pressed', 'true')
  })
})
