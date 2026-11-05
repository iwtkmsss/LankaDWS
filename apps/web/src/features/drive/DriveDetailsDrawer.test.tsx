import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { OverlayProvider } from '../../shared/ui/Overlay'
import { DriveDetailsDrawer } from './DriveDetailsDrawer'
vi.mock('../../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'usr_me', accountType: 'USER' } }) }))

vi.mock('../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: vi.fn(),
}))

const detail = {
  id: 'doc_one',
  number: 'DOC-1',
  name: 'Звіт',
  updatedAt: '2026-09-04T10:00:00.000Z',
  ownerId: 'usr_me', version: 2, archivedAt: null,
  fileId: 'file_image',
  file: { name: 'report.png', mimeType: 'image/png', bytes: 1024, scanStatus: 'CLEAN' },
}

function mount(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OverlayProvider>
        <DriveDetailsDrawer documentId="doc_one" onClose={onClose} />
      </OverlayProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/documents/doc_one') return detail
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('Drive document preview', () => {
  it('deletes a file opened through its URL and closes the preview', async () => {
    vi.mocked(api).mockImplementation(async (path) => path === '/documents/doc_one/archive' ? { archived: true } : detail)
    const onClose = vi.fn()
    mount(onClose)
    fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api).toHaveBeenCalledWith('/documents/doc_one/archive', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2 }) }))
  })
  it('opens the file directly and shows metadata without version history', async () => {
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Звіт' })
    expect(within(dialog).queryByRole('button', { name: 'Зберегти на Диск' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Звіт' })).toHaveAttribute('src', '/api/v1/files/file_image/download?inline=true')
    expect(within(dialog).getByText('Номер: DOC-1')).toBeVisible()
    expect(within(dialog).getByText(/Оновлено:/)).toBeVisible()
    expect(screen.queryByText('Історія версій')).not.toBeInTheDocument()
  })
  it('shows PDFs with a link to open only the file in a new tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('%PDF-1.4')))
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:drive-pdf')
      static revokeObjectURL = vi.fn()
    })
    vi.mocked(api).mockResolvedValue({ ...detail, fileId: 'file_pdf', file: { ...detail.file, mimeType: 'application/pdf' } })
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Звіт' })
    expect(await within(dialog).findByTitle('Перегляд Звіт')).toHaveAttribute('src', 'blob:drive-pdf')
    const open = within(dialog).getByRole('link', { name: 'Відкрити файл у новій вкладці' })
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('href', '/api/v1/files/file_pdf/download?inline=true')
  })
  it('handles a document without an attached file', async () => {
    vi.mocked(api).mockResolvedValue({ ...detail, fileId: null, file: null })
    mount()
    expect(await screen.findByText('Файл для перегляду недоступний.')).toBeVisible()
  })
})
