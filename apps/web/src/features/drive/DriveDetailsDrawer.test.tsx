import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { OverlayProvider } from '../../shared/ui/Overlay'
import { DriveDetailsDrawer } from './DriveDetailsDrawer'

vi.mock('../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: vi.fn(),
}))

const detail = {
  id: 'doc_one',
  number: 'DOC-1',
  name: 'Звіт',
  updatedAt: '2026-09-04T10:00:00.000Z',
  versions: [
    { id: 'ver_image', fileId: 'file_image', version: 2, changeSummary: 'Фото', createdAt: '2026-09-04T10:00:00.000Z', file: { name: 'report.png', mimeType: 'image/png', bytes: 1024, scanStatus: 'CLEAN' } },
    { id: 'ver_pdf', fileId: 'file_pdf', version: 1, changeSummary: 'Перша версія', createdAt: '2026-09-03T10:00:00.000Z', file: { name: 'report.pdf', mimeType: 'application/pdf', bytes: 2048, scanStatus: 'CLEAN' } },
  ],
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OverlayProvider>
        <DriveDetailsDrawer documentId="doc_one" onClose={() => {}} />
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
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('DriveDetailsDrawer', () => {
  it('lists every version newest first with its change summary', async () => {
    mount()

    await screen.findByText('Версія 2')
    expect(screen.getByText('Фото')).toBeVisible()
    expect(screen.getByText('Версія 1')).toBeVisible()
    expect(screen.getByText('Перша версія')).toBeVisible()
  })

  it('opens the current image version in the shared preview', async () => {
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Переглянути$/ }))

    const dialog = screen.getByRole('dialog', { name: 'report.png' })
    expect(within(dialog).getByRole('img', { name: 'report.png' }))
      .toHaveAttribute('src', '/api/v1/files/file_image/download?inline=true')
    expect(within(dialog).getByRole('link', { name: /Завантажити/ }))
      .toHaveAttribute('href', '/api/v1/files/file_image/download')
  })

  it('switches the preview to an earlier PDF version', async () => {
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Переглянути версію 1' }))

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: 'report.pdf' })
      expect(within(dialog).getByTitle('Перегляд report.pdf'))
        .toHaveAttribute('src', '/api/v1/files/file_pdf/download?inline=true')
    })
  })
})
