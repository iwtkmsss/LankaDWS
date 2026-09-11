import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { OverlayProvider } from '../../shared/ui/Overlay'
import { TopbarContentProvider } from '../../layout/TopbarContent'
import DrivePage from './DrivePage'

vi.mock('../../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { accountType: 'USER', company: { id: 'cmp_one' } } }),
}))
vi.mock('../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: vi.fn(),
}))

const folder = {
  id: 'fol_contracts', name: 'Договори', parentId: null, companyId: 'cmp_one',
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 2, childCount: 1,
  updatedAt: '2026-09-04T10:00:00.000Z', trashedAt: null,
}
const file = {
  id: 'doc_one', number: 'DOC-1', name: 'Звіт', companyId: 'cmp_one', folderId: null,
  fileId: 'file_image', mimeType: 'image/png', fileType: 'IMAGE' as const, sizeBytes: 2048,
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 0,
  version: 3, versionCount: 1, updatedAt: '2026-09-03T10:00:00.000Z', trashedAt: null,
}
const counts = { MY_DRIVE: 2, SHARED: 0, RECENT: 1, TRASH: 0 }

let lastDriveUrl = ''

function mount(initialEntry = '/drive') {
  const router = createMemoryRouter(
    [{ path: '/drive', element: <OverlayProvider><TopbarContentProvider><DrivePage /></TopbarContentProvider></OverlayProvider> }],
    { initialEntries: [initialEntry] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  lastDriveUrl = ''
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/drive?') || path === '/drive') {
      lastDriveUrl = path
      const url = new URLSearchParams(path.split('?')[1] ?? '')
      const inFolder = url.get('folderId')
      return {
        breadcrumbs: inFolder ? [{ id: 'fol_contracts', name: 'Договори' }] : [],
        folders: inFolder ? [] : [folder],
        files: inFolder ? [file] : [file],
        counts,
      }
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('DrivePage', () => {
  it('shows folders and files together with the shared-with marker', async () => {
    mount()

    expect(await screen.findByText('Договори')).toBeVisible()
    expect(screen.getByText('Звіт')).toBeVisible()
    expect(screen.getByText('1 вкладених')).toBeVisible()
  })

  it('navigates into a folder and shows the breadcrumb trail', async () => {
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Договори' }))

    await waitFor(() => expect(lastDriveUrl).toContain('folderId=fol_contracts'))
    const trail = await screen.findByRole('navigation', { name: 'Шлях' })
    expect(within(trail).getByRole('button', { name: 'Мій диск' })).toBeVisible()
    expect(within(trail).getByRole('button', { name: 'Договори' })).toBeVisible()
  })

  it('sends the chip filters to the API and marks the chip active', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'IMAGE' } })

    await waitFor(() => expect(lastDriveUrl).toContain('type=IMAGE'))
    expect(screen.getByRole('button', { name: 'Скинути фільтр «Тип»' })).toBeVisible()
  })

  it('switches to the trash view', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.click(screen.getByRole('button', { name: /Кошик/ }))

    await waitFor(() => expect(lastDriveUrl).toContain('view=TRASH'))
  })

  it('keeps the chosen layout in the list toggle', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.click(screen.getByRole('button', { name: 'Список' }))

    expect(screen.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: /Назва/ })).toBeVisible()
  })

  it('moves a file into a folder when it is dropped on one', async () => {
    mount()
    await screen.findByText('Звіт')

    const payload = JSON.stringify({ kind: 'FILE', id: 'doc_one', version: 3 })
    const dataTransfer = {
      types: ['application/x-lankadws-drive-item'],
      getData: (type: string) => type === 'application/x-lankadws-drive-item' ? payload : '',
      dropEffect: '',
    }
    const folderTile = screen.getByText('Договори').closest('article')!

    fireEvent.dragOver(folderTile, { dataTransfer })
    fireEvent.drop(folderTile, { dataTransfer })

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/drive/documents/doc_one/move',
      expect.objectContaining({ method: 'POST' }),
    ))
  })
})
