import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../shared/api/client'
import { OverlayProvider } from '../shared/ui/Overlay'
import { TopbarContentProvider } from '../layout/TopbarContent'
import ContentPages from './ContentPages'

vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { accountType: 'USER', company: { id: 'cmp_one' } } }) }))
vi.mock('../shared/api/client', async (original) => ({ ...await original<typeof import('../shared/api/client')>(), api: vi.fn() }))

const document = {
  id: 'doc_one', number: 'DOC-1', companyId: 'cmp_one', name: 'Звіт', status: 'PUBLISHED', version: 2,
  confidentiality: 'INTERNAL', archivedAt: null,
  versions: [
    { id: 'ver_image', fileId: 'file_image', version: 2, changeSummary: 'Фото', createdAt: '2026-09-04T10:00:00.000Z', status: 'PUBLISHED', file: { name: 'report.png', mimeType: 'image/png', bytes: 1024, scanStatus: 'CLEAN' } },
    { id: 'ver_pdf', fileId: 'file_pdf', version: 1, changeSummary: 'Перша версія', createdAt: '2026-09-03T10:00:00.000Z', status: 'PUBLISHED', file: { name: 'report.pdf', mimeType: 'application/pdf', bytes: 2048, scanStatus: 'CLEAN' } },
  ],
}

function mount() {
  const router = createMemoryRouter([{ path: '/drive/:documentId', element: <OverlayProvider><TopbarContentProvider><ContentPages /></TopbarContentProvider></OverlayProvider> }], { initialEntries: ['/drive/doc_one'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/documents?')) return { items: [], counts: { ALL: 0, MINE: 0, SHARED: 0, DRAFTS: 0, ARCHIVED: 0 } }
    if (path === '/documents/doc_one') return document
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('drive previews', () => {
  it('opens the current image version directly in the document drawer', async () => {
    mount()
    const preview = await screen.findByRole('region', { name: 'Перегляд версії 2' })
    expect(within(preview).getByRole('img', { name: 'report.png' })).toHaveAttribute('src', '/api/v1/files/file_image/download?inline=true')
    fireEvent.click(within(preview).getByRole('button', { name: 'Відкрити переглядач' }))
    const dialog = screen.getByRole('dialog', { name: 'report.png' })
    expect(within(dialog).getByRole('img', { name: 'report.png' })).toHaveAttribute('src', '/api/v1/files/file_image/download?inline=true')
    expect(within(dialog).getByRole('link', { name: 'Завантажити' })).toHaveAttribute('href', '/api/v1/files/file_image/download')
  })

  it('switches the preview to an earlier PDF version', async () => {
    mount()
    await screen.findByRole('region', { name: 'Перегляд версії 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути версію 1' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Перегляд версії 1' })).getByTitle('Перегляд report.pdf')).toHaveAttribute('src', '/api/v1/files/file_pdf/download?inline=true'))
  })
})
